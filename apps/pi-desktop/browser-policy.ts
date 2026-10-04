/** Browser tabs never load executable URLs or the privileged GUI origin. */
export function browserUrl(value: string, applicationUrl: string): string {
  const input = value.trim()
  if (!input || input.length > 8192) throw new Error('Enter an http or https website address')
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(input) && !/^localhost:\d/i.test(input) ? input : /^(localhost|127\.[\d.]+|\[::1\])(?::|\/|$)/i.test(input) ? `http://${input}` : `https://${input}`)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only http and https website addresses are supported')
  const application = new URL(applicationUrl)
  if (url.origin === application.origin || ['127.0.0.1', 'localhost', '[::1]', '0.0.0.0'].includes(url.hostname) && url.port === application.port) throw new Error('The application cannot open inside a browser tab')
  return url.href
}
