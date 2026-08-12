/**
 * The desktop client's wire client: the same four-quadrant protocol contract
 * the harness serves, over the same-origin loopback carrier. The transport
 * aspects (HTTP uplink + one WebSocket per downlink stream) mirror the
 * browser carrier pattern from `dsh-client-connection`, but this client is an
 * independent application — it imports only the protocol contract
 * (`@deepseek-ai/dsh-host-apiproxy`), never the web client plugins.
 * @module desktop/renderer/api/client
 */

import { AbstractApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { hostFrameSchema, muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import { serverRequestSchema, serverResponseSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'

const MUX_PATH = '/api/events.mux'
const HOST_PATH = '/api/events.host'

type SocketItem<F> = { kind: 'frame'; envelope: RpcRequest<F> } | { kind: 'end' }
type Parser<F> = { parse(value: unknown): F }

/**
 * The desktop client carrier: unary/respond over fetch, mux/host over
 * downlink-only WebSockets, exactly like a same-origin browser page.
 */
export class DesktopApiClient extends AbstractApiClient {
  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return globalThis.fetch(input, init)
  }

  /**
   * Invoke one TypeRT Host Remote endpoint (e.g. `messageFeedback/put`).
   * Remotes ride the same four-quadrant envelope as unary methods — method =
   * the remote's wire name, payload = `{ args: { request } }` — so the host
   * gateway dispatches them without any client-side Remote machinery.
   * @param method - the remote's wire path (`<domain>/<verb>`).
   * @param request - the remote's request payload.
   * @returns the remote's response value, or throws on a business error.
   */
  async invokeRemote<T>(method: string, request: unknown): Promise<T> {
    const rpcId = this.mintRpcId()
    const message = {
      type: 'client-request',
      rpcId,
      method,
      payload: { args: { request } },
    } as const
    const response = await this.doFetch(new URL(`/api/${method}`, this.resolveBase()), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
    })
    if (!response.ok) throw new Error(`transport failure for ${method}: HTTP ${response.status}`)
    const full = serverResponseSchema.parse(await response.json())
    if (full.rpcId !== rpcId) throw new Error(`rpcId mismatch for ${method}`)
    if (!full.result.ok) throw new Error(String(full.result.error.message))
    // Remotes wrap the value in a second result envelope (`{ ok, value }`).
    const wrapped = full.result.value as { ok: boolean; value: T } | T
    if (typeof wrapped === 'object' && wrapped !== null && 'ok' in wrapped && 'value' in wrapped) {
      if (!wrapped.ok) throw new Error(String((wrapped as { value: unknown }).value))
      return wrapped.value
    }
    return wrapped
  }

  protected override openMux(
    _payload: Parameters<ApiProxy['events']['mux']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readWebSocket(MUX_PATH, signal, muxFrameSchema, onOpen)
  }

  protected override openHost(
    _payload: Parameters<ApiProxy['events']['host']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    return this.readWebSocket(HOST_PATH, signal, hostFrameSchema, onOpen)
  }

  private async *readWebSocket<F extends MuxFrame | HostFrame>(
    path: string,
    signal: AbortSignal,
    frameSchema: Parser<F>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    const url = new URL(path, this.resolveBase())
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url)
    const inbox: SocketItem<F>[] = []
    let wake: (() => void) | undefined
    const enqueue = (item: SocketItem<F>): void => {
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    const handleOpen = (): void => { onOpen?.() }
    const handleMessage = (event: MessageEvent): void => {
      let full: ServerRequest
      let frame: F
      try {
        if (typeof event.data !== 'string') throw new Error('binary WebSocket frame')
        full = serverRequestSchema.parse(JSON.parse(event.data))
        frame = frameSchema.parse(full.payload)
      } catch (error) {
        console.error(`[desktop] dropping malformed WebSocket frame on ${path}:`, error)
        return
      }
      this.onEnvelope(full)
      enqueue({ kind: 'frame', envelope: { rpcId: full.rpcId, payload: frame } })
    }
    const handleClose = (): void => { enqueue({ kind: 'end' }) }
    const handleAbort = (): void => {
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close()
    }
    socket.addEventListener('open', handleOpen)
    socket.addEventListener('message', handleMessage)
    socket.addEventListener('close', handleClose, { once: true })
    signal.addEventListener('abort', handleAbort, { once: true })
    if (signal.aborted) handleAbort()
    try {
      while (true) {
        while (inbox.length > 0) {
          const item = inbox.shift() as SocketItem<F>
          if (item.kind === 'end') return
          yield item.envelope
        }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', handleAbort)
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('message', handleMessage)
      socket.removeEventListener('close', handleClose)
      handleAbort()
    }
  }
}
