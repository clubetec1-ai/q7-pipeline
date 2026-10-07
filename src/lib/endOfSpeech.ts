/**
 * Fim da fala na entrevista por voz (roadmap Etapa B, item 7): decide, a partir do volume do microfone, quando a pessoa
 * terminou de responder. Regra pura (testada): aprende o ruído do ambiente no começo, só conta silêncio DEPOIS de ter
 * ouvido fala de verdade e encerra após `silenceMs` seguidos de silêncio. Pausado não conta.
 */
export interface SilenceOpts { silenceMs?: number; calibrateMs?: number; minSpeechMs?: number; floor?: number }

export function createSilenceDetector(opts: SilenceOpts = {}) {
  const silenceMs = opts.silenceMs ?? 3000;
  const calibrateMs = opts.calibrateMs ?? 500;
  const minSpeechMs = opts.minSpeechMs ?? 400;
  const floor = opts.floor ?? 0.015;
  let elapsed = 0, noiseSum = 0, noiseN = 0, threshold = floor, speech = 0, silent = 0;
  return {
    /** rms: volume de 0 a 1 neste intervalo; dt: duração do intervalo em ms. Devolve true quando deve encerrar. */
    update(rms: number, dt: number, paused = false): boolean {
      if (paused) { silent = 0; return false; }
      elapsed += dt;
      if (elapsed <= calibrateMs) {
        noiseSum += rms; noiseN++;
        threshold = Math.max(floor, (noiseSum / noiseN) * 2.5);
        return false;
      }
      if (rms > threshold) { speech += dt; silent = 0; return false; }
      if (speech < minSpeechMs) return false; // ainda não falou: esperar (dá tempo de pensar)
      silent += dt;
      return silent >= silenceMs;
    },
    get heardSpeech() { return speech >= minSpeechMs; },
    get silentMs() { return silent; },
  };
}
