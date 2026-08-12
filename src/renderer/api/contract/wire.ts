/**
 * Wire types of the dsh Web UI's public RPC contract (the four-quadrant
 * protocol served under /api). Vendored self-contained mirror of the
 * official @deepseek-ai/dsh-host-apiproxy wire vocabulary: this client speaks
 * the public interface of a running Web UI and imports nothing from the
 * harness repository.
 * @module desktop/renderer/api/contract/wire
 */

/** Opaque correlation token echoed by the server on every full form. */
export type RpcId = string & { readonly __brand?: 'rpc-id' }

/** One client-request full form (the C→S unary/stream leg). */
export interface ClientRequest {
  type: 'client-request'
  rpcId: RpcId
  method: string
  payload: unknown
}

/** One server-response full form (the S→C unary reply). */
export interface ServerResponse {
  type: 'server-response'
  rpcId: RpcId
  result: RpcResult<unknown>
}

/** One server-request full form (the S→C stream frame / server push). */
export interface ServerRequest {
  type: 'server-request'
  rpcId: RpcId
  method: string
  payload: unknown
}

/** One client-response full form (answering a server-request). */
export interface ClientResponse {
  type: 'client-response'
  rpcId: RpcId
  result: RpcResult<unknown>
}

/** Business outcome of one RPC. */
export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: RpcError }

/** One typed server-request as consumed by stream consumers (payload narrowed). */
export interface RpcRequest<F> {
  rpcId: RpcId
  payload: F
}

/** One typed server-response as returned by unary calls (result narrowed). */
export type RpcResponse<T> = { rpcId: RpcId; result: RpcResult<T> }

/** Carrier receipt for client-responses. */
export type RpcReceipt = { accepted: true } | { accepted: false; reason: 'not-pending' | 'bad-response' }

/** A wire RpcError, discriminated by code. */
export interface RpcError {
  code: string
  message: string
  details: Record<string, unknown>
}

/**
 * Wire widening of a contract type: every property becomes `original | undefined`,
 * mirroring how optional fields serialize on the JSON wire.
 */
export type Wire<T> = T extends readonly (infer E)[] ? Wire<E>[]
  : T extends object ? { [K in keyof T]: Wire<T[K]> | undefined }
    : T
