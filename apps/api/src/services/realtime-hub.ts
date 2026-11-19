import { WebSocket } from 'ws';

const allClients = new Set<WebSocket>();
const userSockets = new Map<string, Set<WebSocket>>();

export function registerWsClient(ws: WebSocket, userId: string | null) {
  allClients.add(ws);
  if (userId) {
    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId)!.add(ws);
  }
}

export function unregisterWsClient(ws: WebSocket, userId: string | null) {
  allClients.delete(ws);
  if (userId) {
    userSockets.get(userId)?.delete(ws);
  }
}

export function broadcastToAll(payload: unknown) {
  const serialized = JSON.stringify(payload);
  allClients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serialized);
    }
  });
}

export function broadcastToUser(userId: string, payload: unknown) {
  const set = userSockets.get(userId);
  if (!set) return;
  const serialized = JSON.stringify(payload);
  set.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serialized);
    }
  });
}
