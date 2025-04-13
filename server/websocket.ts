import { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { saveChatMessage, getChatHistory } from './storage';

interface ClientSession {
  ws: WebSocket;
  deviceId: string;
  userId?: string;
}

/**
 * Create a WebSocket server for real-time updates
 * @param server - HTTP server instance
 * @returns WebSocket server instance
 */
export function createWebSocketServer(server: Server) {
  const wss = new WebSocketServer({ server });
  const activeSessions = new Map<string, ClientSession>();

  wss.on('connection', (ws: WebSocket, req: any) => {
    // Generate or extract device ID
    const deviceId = req.headers['sec-websocket-key'] || uuidv4();
    
    const session: ClientSession = { ws, deviceId };
    activeSessions.set(deviceId, session);

    console.log('WebSocket client connected');

    // Send welcome message with device ID
    ws.send(JSON.stringify({
      type: 'connection',
      deviceId,
      message: 'Connected to Ecosense WebSocket Server'
    }));

    // Send chat history for this device
    getChatHistory(deviceId).then(history => {
      ws.send(JSON.stringify({
        type: 'history',
        messages: history
      }));
    });

    // Handle incoming messages
    ws.on('message', async (message: Buffer) => {
      try {
        const parsed = JSON.parse(message.toString());
        parsed.deviceId = deviceId;
        
        console.log('Received message:', parsed);

        if (parsed.type === 'chat') {
          // Save message to device-specific history
          await saveChatMessage(deviceId, parsed.content);
          
          // Route only to same device
          const targetSession = activeSessions.get(deviceId);
          if (targetSession) {
            targetSession.ws.send(JSON.stringify({
              ...parsed,
              timestamp: new Date().toISOString()
            }));
          }
        } else {
          // Handle different message types
          switch (parsed.type) {
            case 'subscribe':
              handleSubscription(ws, parsed);
              break;
            default:
              console.log('Unknown message type:', parsed.type);
          }
        }
      } catch (error) {
        console.error('Error handling message:', error);
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      console.log('WebSocket client disconnected');
      activeSessions.delete(deviceId);
    });
  });

  return wss;
}

/**
 * Handle subscription requests
 * @param ws - WebSocket client
 * @param message - Subscription message
 */
function handleSubscription(ws: WebSocket, message: any) {
  const { channel } = message;
  console.log(`Client subscribed to ${channel}`);

  // Send confirmation
  ws.send(JSON.stringify({
    type: 'subscribed',
    channel
  }));
}

/**
 * Broadcast a message to all connected clients
 * @param wss - WebSocketServer
 * @param message - Message to broadcast
 */
export function broadcastMessage(wss: WebSocketServer, message: any) {
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}