// websocket.js
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
        let aiModel = config.geminiModel;
        let aiTemperature = config.geminiTemperature;
        let aiMaxTokens = config.geminiMaxTokens;
        let aiVoice = 'Polly.Amy'; // Default voice

        // Fixed log function
        const log = (level, ...args) => {
            const prefix = callSid ? `[${callSid}]` : '[WebSocket]';
            if (level === 'error') {
                console.error(prefix, ...args);
            } else {
                console.log(prefix, ...args);
            }
        };

        const logTranscript = async (speaker, text) => {
            if (!callSid || !text) return;
            try {
                await Conversation.updateOne(
                    { callSid: callSid },
                    { $push: { transcript: { speaker, text } } }
                );
            } catch (error) {
                log('error', 'Failed to log transcript to DB:', error);
            }
        };

        const handleStart = (start) => {
            callSid = start.callSid;
            streamSid = start.streamSid;
            aiModel = start.parameters.aiModel || aiModel;
            aiTemperature = parseFloat(start.parameters.aiTemperature) || aiTemperature;
            aiMaxTokens = parseInt(start.parameters.aiMaxTokens, 10) || aiMaxTokens;
            aiVoice = start.parameters.aiVoice || aiVoice;
            log('log', `Starting conversation stream ${streamSid}`);

            const model = genAI.getGenerativeModel({ model: aiModel });
            chat = model.startChat({
                history: [{ role: "user", parts: [{ text: start.parameters.initialPrompt }] }],
            });
        };

        const handleMedia = async (media) => {
            if (media && media.track === 'inbound' && media.chunk > 1) {
                const userText = media.payload;
                log('log', `User said: "${userText}"`);
                await logTranscript('caller', userText);

                if (chat && userText) {
                    try {
                        const result = await chat.sendMessage(userText, {
                            generationConfig: {
                                temperature: aiTemperature,
                                maxOutputTokens: aiMaxTokens,
                            }
                        });
                        const aiResponse = await result.response.text();
                        log('log', `AI said: "${aiResponse}"`);

                        // Clear any previous text
                        ws.send(JSON.stringify({ event: 'clear', streamSid }));

                        // Send the AI response
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

                        await logTranscript('ai_agent', aiResponse);
                    } catch (error) {
                        log('error', 'Error processing AI response:', error);
                        // Send a fallback message
                        ws.send(JSON.stringify({
                            event: 'media',
                            streamSid: streamSid,
                            media: {
                                payload: Buffer.from("I'm sorry, I'm having trouble processing that. Please try again.", 'utf8').toString('base64'),
                                'x-twilio-media': {
                                    'content-type': 'text/plain',
                                    'voice': aiVoice
                                }
                            }
                        }));
                    }
                }
            }
        };

        const handleStop = async () => {
            log('log', 'Twilio stream stopped. Finalizing conversation.');
            if (!callSid) return;

            try {
                const conversation = await Conversation.findOne({ callSid: callSid });
                if (conversation && conversation.transcript && conversation.transcript.length > 0) {
                    const fullTranscript = conversation.transcript
                        .map(t => `${t.speaker}: ${t.text}`)
                        .join('\n');

                    const summaryPrompt = `Please provide a concise, one-paragraph summary of the following call transcript. Also identify the overall sentiment (e.g., Positive, Neutral, Negative) and list the main topics discussed. Format the output as a JSON object with keys "summary", "sentiment", and "topics" (which should be an array of strings). Transcript:\n\n${fullTranscript}`;

                    const model = genAI.getGenerativeModel({ model: aiModel });
                    const result = await model.generateContent(summaryPrompt);
                    const aiResponseText = await result.response.text();

                    try {
                        // Clean up potential markdown formatting from the LLM response
                        const jsonResponse = aiResponseText.replace(/```json|```/g, '').trim();
                        const analysis = JSON.parse(jsonResponse);

                        await Conversation.updateOne(
                            { callSid: callSid },
                            { summary: analysis.summary, sentiment: analysis.sentiment, topics: analysis.topics }
                        );
                        log('log', 'AI summary generated and saved.');
                    } catch (jsonError) {
                        log('error', 'Failed to parse AI summary JSON:', jsonError, 'Raw AI response:', aiResponseText);
                    }
                }
            } catch (error) {
                log('error', 'Error generating summary:', error);
            }
        };

        ws.on('message', async (message) => {
            try {
                const msg = JSON.parse(message);
                switch (msg.event) {
                    case 'connected':
                        log('log', `Twilio stream connected: ${msg.streamSid}`);
                        break;
                    case 'start':
                        handleStart(msg.start);
                        break;
                    case 'media':
                        await handleMedia(msg.media);
                        break;
                    case 'stop':
                        await handleStop();
                        break;
                    case 'mark':
                        log('log', `Mark event received: ${msg.mark.name}`);
                        break;
                    case 'dtmf':
                        log('log', `DTMF digit received: ${msg.dtmf.digit}`);
                        break;
                }
            } catch (error) {
                log('error', 'Error processing WebSocket message:', error);
            }
        });

        ws.on('close', () => {
            log('log', 'WebSocket connection closed.');
        });
    });
}

module.exports = setupWebSocket;