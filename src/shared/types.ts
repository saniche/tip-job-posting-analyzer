/** 'waiting' is local only (queued in the extension). The rest mirror the server's processing-job statuses. */
export type JobStatus = 'waiting' | 'pending' | 'processing' | 'completed' | 'failed';

export interface PagePayload {
  url: string;
  title: string;    // display only, not sent
  content: string;  // the job posting's full text, as it stands
}

/** POST /jobs/analyze */
export interface AnalyzeResponse {
  id: string;                       // page_id
  status: string;
  processing_job_id: string | null;
  title: string | null;
  url: string | null;
  created_at: string | null;
}

/** GET /processing-jobs/{processing_job_id} */
export interface ProcessingJobResponse {
  id: string;
  status: string;                   // pending | processing | completed | failed
  result_id: string | null;
  error: string | null;
}

export interface Job {
  id: string;                       // local id
  url: string;
  title: string;
  snippet: string;
  status: JobStatus;
  pageId?: string;
  processingJobId?: string;
  resultId?: string;
  payload?: PagePayload;            // kept only while 'waiting', dropped after submit
  submittedAt: number;
  startedAt?: number;
  updatedAt: number;
  nextPollAt?: number;
  pollCount?: number;
  failures?: number;
  result?: unknown;                 // whatever the result endpoint returns
  error?: string;
}
