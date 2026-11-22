import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const DEFAULT_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

const OPCODE_CONTINUATION = 0x0;
const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

type WebSocketConnectionOptions = {
  maxMessageBytes?: number;
};

// Schlanke RFC-6455-WebSocket-Verbindung auf Basis eines Node-HTTP-Upgrade-Sockets (ohne externe Pakete)
class WebSocketConnection {
  readonly #socket: Duplex;
  readonly #maxMessageBytes: number;
  readonly #messageListeners = new Set<(text: string) => void>();
  readonly #pongListeners = new Set<() => void>();
  readonly #closeListeners = new Set<(code: number, reason: string) => void>();
  readonly #errorListeners = new Set<(error: Error) => void>();

  #buffer: Buffer = Buffer.alloc(0);
  #fragmentOpcode: number | null = null;
  #fragments: Buffer[] = [];
  #fragmentsBytes = 0;
  #closed = false;

  constructor(socket: Duplex, maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES) {
    this.#socket = socket;
    this.#maxMessageBytes = maxMessageBytes;

    socket.on("data", (chunk: Buffer) => {
      this.#handleData(chunk);
    });
    socket.on("close", () => {
      this.#markClosed(1006, "");
    });
    socket.on("error", (error: Error) => {
      for (const listener of this.#errorListeners) {
        listener(error);
      }
      this.#markClosed(1006, error.message);
    });
  }

  get isClosed(): boolean {
    return this.#closed;
  }

  // Führt den HTTP-101-Handshake durch und gibt bei Erfolg eine WebSocketConnection zurück
  static upgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    options?: WebSocketConnectionOptions,
  ): WebSocketConnection | null {
    const upgradeHeader = req.headers.upgrade;
    const keyHeader = req.headers["sec-websocket-key"];
    if (
      typeof upgradeHeader !== "string" ||
      upgradeHeader.toLowerCase() !== "websocket" ||
      typeof keyHeader !== "string" ||
      keyHeader.trim().length === 0
    ) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return null;
    }

    const accept = createHash("sha1")
      .update(`${keyHeader.trim()}${WS_MAGIC_GUID}`)
      .digest("base64");

    const headers = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ];
    socket.write(headers.join("\r\n"));

    const connection = new WebSocketConnection(socket, options?.maxMessageBytes);
    if (head.length > 0) {
      connection.#handleData(head);
    }
    return connection;
  }

  onMessage(listener: (text: string) => void): void {
    this.#messageListeners.add(listener);
  }

  onPong(listener: () => void): void {
    this.#pongListeners.add(listener);
  }

  onClose(listener: (code: number, reason: string) => void): void {
    this.#closeListeners.add(listener);
  }

  onError(listener: (error: Error) => void): void {
    this.#errorListeners.add(listener);
  }

  sendText(text: string): void {
    this.#sendFrame(OPCODE_TEXT, Buffer.from(text, "utf-8"));
  }

  ping(): void {
    this.#sendFrame(OPCODE_PING, Buffer.alloc(0));
  }

  close(code = 1000, reason = ""): void {
    if (this.#closed) {
      return;
    }
    const reasonBuf = Buffer.from(reason, "utf-8").subarray(0, 123);
    const payload = Buffer.alloc(2 + reasonBuf.length);
    payload.writeUInt16BE(code, 0);
    reasonBuf.copy(payload, 2);
    this.#sendFrame(OPCODE_CLOSE, payload);
    this.#markClosed(code, reason);
    this.#socket.end();
  }

  #markClosed(code: number, reason: string): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#fragments = [];
    this.#fragmentsBytes = 0;
    this.#fragmentOpcode = null;
    for (const listener of this.#closeListeners) {
      listener(code, reason);
    }
  }

  #sendFrame(opcode: number, payload: Buffer): void {
    if (this.#closed || this.#socket.destroyed) {
      return;
    }
    const len = payload.length;
    let header: Buffer;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = len;
    } else if (len <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }

    this.#socket.write(Buffer.concat([header, payload]));
  }

  #handleData(chunk: Buffer): void {
    if (this.#closed) {
      return;
    }
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);

    while (this.#buffer.length >= 2 && !this.#closed) {
      const firstByte = this.#buffer[0];
      const secondByte = this.#buffer[1];
      const fin = (firstByte & 0x80) !== 0;
      const rsv = firstByte & 0x70;
      const opcode = firstByte & 0x0f;
      const masked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7f;
      let offset = 2;

      if (rsv !== 0 || !masked) {
        this.close(1002, "Protocol error");
        return;
      }

      if (payloadLength === 126) {
        if (this.#buffer.length < offset + 2) {
          return;
        }
        payloadLength = this.#buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        if (this.#buffer.length < offset + 8) {
          return;
        }
        const bigLen = this.#buffer.readBigUInt64BE(offset);
        if (bigLen > BigInt(this.#maxMessageBytes)) {
          this.close(1009, "Message too large");
          return;
        }
        payloadLength = Number(bigLen);
        offset += 8;
      }

      if (payloadLength > this.#maxMessageBytes) {
        this.close(1009, "Message too large");
        return;
      }

      if (this.#buffer.length < offset + 4 + payloadLength) {
        return;
      }

      const maskKey = this.#buffer.subarray(offset, offset + 4);
      const maskedPayload = this.#buffer.subarray(offset + 4, offset + 4 + payloadLength);
      const payload = Buffer.allocUnsafe(payloadLength);
      for (let i = 0; i < payloadLength; i += 1) {
        payload[i] = maskedPayload[i] ^ maskKey[i & 3];
      }

      this.#buffer = this.#buffer.subarray(offset + 4 + payloadLength);
      this.#processFrame(fin, opcode, payload);
    }
  }

  #processFrame(fin: boolean, opcode: number, payload: Buffer): void {
    // Control-Frames dürfen nicht fragmentiert werden und höchstens 125 Bytes lang sein
    if ((opcode & 0x08) !== 0) {
      if (!fin || payload.length > 125) {
        this.close(1002, "Invalid control frame");
        return;
      }
      if (opcode === OPCODE_CLOSE) {
        const closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
        const closeReason = payload.length > 2 ? payload.subarray(2).toString("utf-8") : "";
        this.close(closeCode, closeReason);
      } else if (opcode === OPCODE_PING) {
        this.#sendFrame(OPCODE_PONG, payload);
      } else if (opcode === OPCODE_PONG) {
        for (const listener of this.#pongListeners) {
          listener();
        }
      }
      return;
    }

    if (opcode === OPCODE_CONTINUATION) {
      if (this.#fragmentOpcode === null) {
        this.close(1002, "Unexpected continuation frame");
        return;
      }
    } else if (opcode === OPCODE_TEXT || opcode === OPCODE_BINARY) {
      if (this.#fragmentOpcode !== null) {
        this.close(1002, "Unfinished fragmented message");
        return;
      }
      this.#fragmentOpcode = opcode;
      this.#fragments = [];
      this.#fragmentsBytes = 0;
    } else {
      this.close(1003, "Unsupported opcode");
      return;
    }

    this.#fragmentsBytes += payload.length;
    if (this.#fragmentsBytes > this.#maxMessageBytes) {
      this.close(1009, "Message too large");
      return;
    }
    this.#fragments.push(payload);

    if (!fin) {
      return;
    }

    const completedOpcode = this.#fragmentOpcode;
    const messageBuffer = this.#fragments.length === 1 ? this.#fragments[0] : Buffer.concat(this.#fragments);
    this.#fragmentOpcode = null;
    this.#fragments = [];
    this.#fragmentsBytes = 0;

    if (completedOpcode === OPCODE_TEXT) {
      const text = messageBuffer.toString("utf-8");
      for (const listener of this.#messageListeners) {
        listener(text);
      }
    }
  }
}

export default WebSocketConnection;
