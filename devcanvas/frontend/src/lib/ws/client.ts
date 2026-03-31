export type WSMessage = {
	type: string;
	[key: string]: unknown;
};

type MessageHandler = (msg: WSMessage) => void;
type ConnectHandler = () => void;
type DisconnectHandler = () => void;

const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 16000, 30000];

export class BufferedReconnectingWebSocket {
	private url: string;
	private ws: WebSocket | null = null;
	private reconnectAttempt = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private destroyed = false;
	private sendQueue: string[] = [];
	private outputBuffer: string[] = [];
	private outputTimer: ReturnType<typeof setTimeout> | null = null;
	private outputHandler: ((data: string) => void) | null = null;

	public onMessage: MessageHandler | null = null;
	public onConnect: ConnectHandler | null = null;
	public onDisconnect: DisconnectHandler | null = null;

	constructor(url: string) {
		this.url = url;
		this.connect();
	}

	private connect() {
		if (this.destroyed) return;

		try {
			this.ws = new WebSocket(this.url);

			this.ws.onopen = () => {
				this.reconnectAttempt = 0;
				this.flushQueue();
				this.onConnect?.();
			};

			this.ws.onclose = () => {
				this.ws = null;
				this.onDisconnect?.();
				this.scheduleReconnect();
			};

			this.ws.onerror = () => {
				this.ws?.close();
			};

			this.ws.onmessage = (event) => {
				try {
					const msg: WSMessage = JSON.parse(event.data as string);

					// Buffer terminal output for 20ms batching
					if (msg.type === 'terminal:output' && typeof msg.data === 'string') {
						this.outputBuffer.push(msg.data);
						if (!this.outputTimer) {
							this.outputTimer = setTimeout(() => {
								const batch = this.outputBuffer.join('');
								this.outputBuffer = [];
								this.outputTimer = null;
								this.outputHandler?.(batch);
							}, 20);
						}
					} else {
						this.onMessage?.(msg);
					}
				} catch {
					// ignore parse errors
				}
			};
		} catch {
			this.scheduleReconnect();
		}
	}

	private scheduleReconnect() {
		if (this.destroyed) return;
		const delay = BACKOFF_STEPS[Math.min(this.reconnectAttempt, BACKOFF_STEPS.length - 1)];
		const jitter = Math.random() * 500;
		this.reconnectAttempt++;
		this.reconnectTimer = setTimeout(() => this.connect(), delay + jitter);
	}

	private flushQueue() {
		while (this.sendQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
			const msg = this.sendQueue.shift()!;
			this.ws.send(msg);
		}
	}

	public send(msg: WSMessage) {
		const str = JSON.stringify(msg);
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(str);
		} else {
			this.sendQueue.push(str);
		}
	}

	public setOutputHandler(handler: (data: string) => void) {
		this.outputHandler = handler;
	}

	public get connected(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}

	public reconnect() {
		if (this.destroyed) return;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		if (this.outputTimer) clearTimeout(this.outputTimer);
		this.outputBuffer = [];
		this.outputTimer = null;
		this.reconnectAttempt = 0;
		this.ws?.close();
		this.ws = null;
		this.connect();
	}

	public destroy() {
		this.destroyed = true;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		if (this.outputTimer) clearTimeout(this.outputTimer);
		this.ws?.close();
		this.ws = null;
	}
}
