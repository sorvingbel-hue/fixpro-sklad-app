// Хранение объектов смены — ТОЛЬКО на этом устройстве (в браузере — localStorage, фото — IndexedDB).
// В базу команды ничего не уходит: демо для друзей не может испортить или увидеть чужие данные.
import { getJSON, removeItem, setJSON } from '@/lib/storage';

import type { WorkV03Doc } from '../work/import-v03';
import { normalizeWork, seedWork } from '../work/work-model';
import { normalizeJobs, sortJobs, workForJob, type Job } from './jobs-model';
import { deletePhotos } from './photo-store';

const INDEX = 'fm.jobs.v1';
const workKey = (id: string) => `fm.job.${id}.work`;

export async function loadJobs(): Promise<Job[]> {
  return sortJobs(normalizeJobs(await getJSON<unknown>(INDEX, [])));
}

export async function saveJobs(jobs: Job[]): Promise<boolean> {
  return setJSON(INDEX, jobs);
}

export async function loadWork(jobId: string): Promise<WorkV03Doc> {
  const raw = await getJSON<unknown>(workKey(jobId), null);
  const d = normalizeWork(raw);
  return d && d.job === jobId ? d : workForJob(seedWork(), jobId);
}

export async function saveWork(d: WorkV03Doc): Promise<boolean> {
  return setJSON(workKey(d.job), d);
}

export async function deleteJobData(job: Job): Promise<void> {
  await deletePhotos(job.photos.map(p => p.id));
  await removeItem(workKey(job.id));
}
