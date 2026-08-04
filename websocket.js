const { WebSocketServer } = require('ws');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Conversation = require('../models/Conversation');
const config = require('../config');

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

function setupWebSocket(server) {
    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
        console.log('WebSocket connection established.');
        let chat;
        let callSid;
        let streamSid;
        let aiVoice = 'Polly.Amy'; // Default voice

        ws.on('message', async (message) => {
            const msg = JSON.parse(message);

            switch (msg.event) {
                case 'connected':
                    console.log(`Twilio stream connected for call ${msg.streamSid}`);
                    streamSid = msg.streamSid;
                    break;

                case 'start':
                    console.log(`Starting conversation for call ${msg.start.callSid}`);
                    callSid = msg.start.callSid;
                    streamSid = msg.start.streamSid;
                    aiVoice = msg.start.parameters.aiVoice || aiVoice; // Use voice from parameters
                    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
                    chat = model.startChat({
                        history: [{ role: "user", parts: msg.start.parameters.initialPrompt }],
                    });
                    break;

                case 'media':
                    if (msg.media && msg.media.track === 'inbound' && msg.media.chunk > 1) {
                        try {
                            const userText = msg.media.payload;
                            console.log(`User said: "${userText}"`);

                            if (callSid && userText) {
                                await Conversation.updateOne(
                                    { callSid: callSid },
                                    { $push: { transcript: { speaker: 'caller', text: userText } } }
                                );
                            }

                            if (chat && userText) {
                                const result = await chat.sendMessage(userText);
                                const aiResponse = await result.response.text();
                                console.log(`AI said: "${aiResponse}"`);

                                ws.send(JSON.stringify({ event: 'clear', streamSid }));

                                ws.send(JSON.stringify({
                                    event: 'media',
                                    streamSid: streamSid,
                                    media: {
                                        payload: Buffer.from(aiResponse, 'utf8').toString('base64'),
                                        'x-twilio-media': {
                                            'content-type': 'text/plain',
                                            'voice': aiVoice
                                        }
                                    }
                                }));

                                if (callSid) {
                                    await Conversation.updateOne(
                                        { callSid: callSid },
                                        { $push: { transcript: { speaker: 'ai_agent', text: aiResponse } } }
                                    );
                                }
                            }
                        } catch (error) {
                            console.error("Error during Gemini interaction:", error);
                        }
                    }
                    break;

                case 'stop':
                    console.log(`Twilio stream stopped for call ${callSid}. Finalizing conversation.`);
                    if (callSid) {
                        try {
                            const conversation = await Conversation.findOne({ callSid: callSid });
                            if (conversation && conversation.transcript.length > 0) {
                                const fullTranscript = conversation.transcript
                                    .map(t => `${t.speaker}: ${t.text}`)
                                    .join('\n');

                                const summaryPrompt = `Please provide a concise, one-paragraph summary of the following call transcript. Also identify the overall sentiment (e.g., Positive, Neutral, Negative) and list the main topics discussed. Format the output as a JSON object with keys "summary", "sentiment", and "topics" (which should be an array of strings). Transcript:\n\n${fullTranscript}`;

                                const model = genAI.getGenerativeModel({ model: "gemini-pro" });
                                const result = await model.generateContent(summaryPrompt);
                                const aiResponse = await result.response.text();

                                const jsonResponse = aiResponse.replace(/```json|```/g, '').trim();
                                const analysis = JSON.parse(jsonResponse);

                                await Conversation.updateOne(
                                    { callSid: callSid },
                                    { summary: analysis.summary, sentiment: analysis.sentiment, topics: analysis.topics }
                                );
                                console.log(`AI summary generated and saved for ${callSid}.`);
                            }
                        } catch (error) {
                            console.error(`Error generating summary for ${callSid}:`, error);
                        }
                    }
                    break;

                case 'mark':
                    console.log(`Mark event received: ${msg.mark.name}`);
                    break;

                case 'dtmf':
                    console.log(`DTMF digit received: ${msg.dtmf.digit}`);
                    break;
            }
        });

        ws.on('close', () => {
            console.log('WebSocket connection closed.');
        });
    });
}

module.exports = setupWebSocket;