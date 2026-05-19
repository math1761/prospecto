const CLIENT_WRAPPERS: Record<string, (html: string) => string> = {
  gmail: (html) =>
    `<div class="gmail_default" style="font-family:Arial,sans-serif;font-size:13px">${html}</div>`,

  gmail_mobile: (html) =>
    `<div style="font-family:sans-serif;font-size:14px;max-width:100vw;overflow-x:hidden">${html}</div>`,

  outlook: (html) =>
    `<!--[if mso]><table width="100%"><tr><td><![endif]-->${html}<!--[if mso]></td></tr></table><![endif]-->`,

  outlook_dark: (html) =>
    `<meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light"><!--[if mso]><table width="100%"><tr><td><![endif]-->${html}<!--[if mso]></td></tr></table><![endif]-->`,

  apple_mail: (html) => html,

  dark_gmail: (html) =>
    `<meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light"><div class="gmail_default" style="font-family:Arial,sans-serif;font-size:13px">${html}</div>`,
};

export function wrapForClient(html: string, client: string): string {
  const wrapper = CLIENT_WRAPPERS[client];
  if (!wrapper) return html;
  return wrapper(html);
}

export function toHtml(body: string): string {
  return body.replace(/\n/g, "<br>");
}
