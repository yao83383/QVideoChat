/**
 * Audio Capture — captures audio chunks from WebRTC AudioTrack or mic stream
 * for ASR processing. Buffers PCM data and emits slices for transcription.
 */

export type AudioChunkCallback = (chunk: Float32Array) => void;

export class AudioCapture {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private buffer: Float32Array;
  private bufferOffset = 0;
  private readonly chunkSize: number;
  private readonly sampleRate: number;
  private onChunk: AudioChunkCallback;
  private running = false;

  /**
   * @param chunkSeconds  size of each audio chunk in seconds
   * @param sampleRate    target sample rate (default 16000 for ASR)
   */
  constructor(onChunk: AudioChunkCallback, chunkSeconds = 2, sampleRate = 16000) {
    this.onChunk = onChunk;
    this.sampleRate = sampleRate;
    this.chunkSize = sampleRate * chunkSeconds;
    this.buffer = new Float32Array(this.chunkSize);
  }

  async start(stream: MediaStream): Promise<void> {
    if (this.running) return;
    this.ctx = new AudioContext({ sampleRate: this.sampleRate });
    this.source = this.ctx.createMediaStreamSource(stream);

    // ScriptProcessorNode is deprecated but universally supported and simple.
    // For production, consider AudioWorklet for better performance.
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => {
      if (!this.running) return;
      const input = e.inputBuffer.getChannelData(0);
      this.appendBuffer(input);
    };

    this.source.connect(this.processor);
    this.processor.connect(this.ctx.destination);
    this.running = true;
  }

  private appendBuffer(data: Float32Array): void {
    let remaining = this.chunkSize - this.bufferOffset;
    let copied = 0;

    while (copied < data.length) {
      const toCopy = Math.min(remaining, data.length - copied);
      this.buffer.set(data.subarray(copied, copied + toCopy), this.bufferOffset);
      this.bufferOffset += toCopy;
      copied += toCopy;

      if (this.bufferOffset >= this.chunkSize) {
        // Emit a copy of the filled buffer
        this.onChunk(new Float32Array(this.buffer));
        this.bufferOffset = 0;
        remaining = this.chunkSize;
      }
    }
  }

  stop(): void {
    this.running = false;
    this.processor?.disconnect();
    this.source?.disconnect();
    this.ctx?.close();
    this.processor = null;
    this.source = null;
    this.ctx = null;
    this.bufferOffset = 0;
    this.buffer = new Float32Array(this.chunkSize);
  }
}
