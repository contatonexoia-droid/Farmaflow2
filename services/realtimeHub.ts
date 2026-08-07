import { Response } from "express";

export interface RealtimeClient {
  id: string;
  storeId: string;
  res: Response;
}

export class RealtimeHub {
  private static instance: RealtimeHub;
  private clients: Map<string, RealtimeClient> = new Map();

  private constructor() {}

  public static getInstance(): RealtimeHub {
    if (!RealtimeHub.instance) {
      RealtimeHub.instance = new RealtimeHub();
    }
    return RealtimeHub.instance;
  }

  public addClient(client: RealtimeClient) {
    this.clients.set(client.id, client);
    console.log(`[RealtimeHub] Client ${client.id} connected for store ${client.storeId}. Total connected: ${this.clients.size}`);

    // Send initial handshake
    this.sendToClient(client, "connected", { clientId: client.id, timestamp: Date.now() });

    client.res.on("close", () => {
      this.clients.delete(client.id);
      console.log(`[RealtimeHub] Client ${client.id} disconnected. Total connected: ${this.clients.size}`);
    });
  }

  public sendToClient(client: RealtimeClient, event: string, data: any) {
    client.res.write(`event: ${event}\n`);
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  public broadcastToStore(storeId: string, event: string, data: any) {
    let count = 0;
    this.clients.forEach((client) => {
      if (client.storeId === storeId || storeId === "all") {
        this.sendToClient(client, event, data);
        count++;
      }
    });
    console.log(`[RealtimeHub] Broadcast event '${event}' to ${count} clients in store ${storeId}`);
  }
}

export const realtimeHub = RealtimeHub.getInstance();
