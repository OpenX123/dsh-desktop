/**
 * Where an official `dsh web` may be listening, as far as this client can tell.
 *
 * The bundled web app composes its port as `port: !!js ctx.webStartup.port ??
 * 3080`, so the default is only a fallback. A `--port` flag beats it, and so
 * does a `port:` written into the profile's own patch layer against the
 * `webserver` row. The flag leaves nothing behind to read; the patch layer is a
 * file, and a user who moved their instance there is exactly the user this
 * client would otherwise fail to see — and start a second harness beside, which
 * corrupts the session store they share.
 *
 * Parsing is deliberately loose. The patch layer is a free-form YAML array that
 * may carry `!!js` expressions, and no reading of it needs to be exact: what
 * confirms an origin is `host.describe` replying on it, not this file. A wrong
 * number costs one probe that goes unanswered.
 * @module dsh-desktop/web-discovery
 */

/** Ports named anywhere in a profile patch layer, in the order they appear. */
export function configuredWebPorts(patchSource: string): number[] {
  const ports: number[] = []
  for (const match of patchSource.matchAll(/^\s*(?:-\s*)?port:\s*['"]?(\d{2,5})['"]?\s*$/gm)) {
    const port = Number(match[1])
    if (port <= 0 || port > 65535 || ports.includes(port)) continue
    ports.push(port)
  }
  return ports
}

/**
 * Every origin smart mode should try before concluding nothing is running: the
 * default first, so the common case is decided by the first probe.
 */
export function webProbeOrigins(defaultOrigin: string, patchSource: string): string[] {
  const origins = [defaultOrigin]
  for (const port of configuredWebPorts(patchSource)) {
    const candidate = 'http://127.0.0.1:' + String(port)
    if (!origins.includes(candidate)) origins.push(candidate)
  }
  return origins
}
