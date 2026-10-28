// A helper worker of the build's pool (pool.ts): holds the grey rasters it is sent, runs tie, colour and crop tasks.
import { browserPhoto } from "./browserPhotos";
import { type HelperMessage, type PoolTask, type TaskContext, handleTask } from "./pool";
import { colourObservations } from "./weeds";

const ctx: TaskContext = { rasters: new Map(), photo: (file, name) => browserPhoto(file, name), colour: colourObservations };
const post = (m: HelperMessage, transfer: ArrayBuffer[] = []) => (self as unknown as { postMessage: (m: HelperMessage, t: ArrayBuffer[]) => void }).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<{ id: number; task: PoolTask }>) => {
  const { id, task } = e.data;
  try {
    const { result, transfer } = await handleTask(task, ctx);
    post({ id, result }, transfer);
  } catch (err) {
    post({ id, error: (err as Error)?.message ?? String(err) });
  }
};
