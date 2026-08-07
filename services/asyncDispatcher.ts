import { EventEmitter } from "events";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://nalshjhoiecxooejpiaw.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy';
const supabase = createClient(supabaseUrl, supabaseKey);

export interface QueueJob<T = any> {
  id: string;
  eventName: string;
  payload: T;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  processAfter?: number;
}

export class AsyncDispatcher extends EventEmitter {
  private static instance: AsyncDispatcher;
  private queue: QueueJob[] = [];
  private dlq: QueueJob[] = [];
  private isProcessing = false;
  private concurrency = 10;
  private activeWorkers = 0;

  private stats = {
    processedTotal: 0,
    failedTotal: 0,
    dlqTotal: 0,
  };

  private constructor() {
    super();
    this.startWorkerLoop();
  }

  public static getInstance(): AsyncDispatcher {
    if (!AsyncDispatcher.instance) {
      AsyncDispatcher.instance = new AsyncDispatcher();
    }
    return AsyncDispatcher.instance;
  }

  /**
   * Enfileira um evento e retorna imediatamente sem bloquear o HTTP Response
   */
  public dispatch<T = any>(eventName: string, payload: T, delayMs = 0): string {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const job: QueueJob<T> = {
      id: jobId,
      eventName,
      payload,
      retryCount: 0,
      maxRetries: 3,
      createdAt: Date.now(),
      processAfter: delayMs > 0 ? Date.now() + delayMs : undefined,
    };

    this.queue.push(job);
    this.emit("job_enqueued", job);
    return jobId;
  }

  private startWorkerLoop() {
    setInterval(async () => {
      await this.processQueue();
    }, 100);
  }

  private async processQueue() {
    if (this.queue.length === 0 || this.activeWorkers >= this.concurrency) return;

    const now = Date.now();
    const jobIndex = this.queue.findIndex((j) => !j.processAfter || j.processAfter <= now);

    if (jobIndex === -1) return;

    const job = this.queue.splice(jobIndex, 1)[0];
    this.activeWorkers++;

    // Processar assincronamente
    this.executeJob(job).finally(() => {
      this.activeWorkers--;
    });
  }

  private async executeJob(job: QueueJob) {
    try {
      console.log(`[AsyncDispatcher] Processing job ${job.id} (${job.eventName})`);
      this.emit(job.eventName, job.payload, job);
      this.stats.processedTotal++;
    } catch (error: any) {
      console.error(`[AsyncDispatcher] Error executing job ${job.id}:`, error);

      if (job.retryCount < job.maxRetries) {
        job.retryCount++;
        // Backoff exponencial: 2s, 4s, 8s...
        const backoffMs = Math.pow(2, job.retryCount) * 1000;
        job.processAfter = Date.now() + backoffMs;
        this.queue.push(job);
        console.warn(`[AsyncDispatcher] Re-queued job ${job.id} with backoff ${backoffMs}ms (attempt ${job.retryCount}/${job.maxRetries})`);
      } else {
        console.error(`[AsyncDispatcher] Job ${job.id} reached max retries. Moving to DLQ.`);
        this.dlq.push(job);
        this.stats.failedTotal++;
        this.stats.dlqTotal++;
        this.emit("job_dlq", job, error);
      }
    }
  }

  public getStats() {
    return {
      pending: this.queue.length,
      activeWorkers: this.activeWorkers,
      dlqSize: this.dlq.length,
      ...this.stats,
    };
  }
}

export const dispatcher = AsyncDispatcher.getInstance();
