/** Split markdown/text into ~`size` char chunks along headings & paragraphs, with overlap. */
export function chunkText(text, { size = 900, overlap = 150 } = {}) {
  const sections = text.split(/\n(?=#{1,4} )/);
  const chunks = [];
  for (const sec of sections) {
    const heading = (sec.match(/^#{1,4} (.+)/) || [])[1] || null;
    const paras = sec.split(/\n{2,}/);
    let buf = '';
    for (const p of paras) {
      if ((buf + '\n\n' + p).length > size && buf) {
        chunks.push({ heading, content: buf.trim() });
        buf = buf.slice(-overlap) + '\n\n' + p;
      } else buf += (buf ? '\n\n' : '') + p;
    }
    if (buf.trim()) chunks.push({ heading, content: buf.trim() });
  }
  return chunks;
}

