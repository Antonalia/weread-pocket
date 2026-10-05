(function getLocalImageDimensions(input, mime) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer,input.byteOffset,input.byteLength) : null;
  if (!bytes || bytes.length < 12) return null;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at, length) => String.fromCharCode(...bytes.subarray(at,at+length));
  const size = (width,height) => Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 ? {width,height} : null;
  const u24 = at => bytes[at] | bytes[at+1]<<8 | bytes[at+2]<<16;
  if (mime === 'image/png' && bytes.length >= 24 && data.getUint32(0) === 0x89504e47 && text(12,4) === 'IHDR') return size(data.getUint32(16),data.getUint32(20));
  if (mime === 'image/gif' && /^GIF8[79]a$/.test(text(0,6))) return size(data.getUint16(6,true),data.getUint16(8,true));
  if (mime === 'image/bmp' && text(0,2) === 'BM' && bytes.length >= 26) {
    const dib = data.getUint32(14,true);
    return dib === 12 ? size(data.getUint16(18,true),data.getUint16(20,true)) : dib >= 40 ? size(data.getInt32(18,true),Math.abs(data.getInt32(22,true))) : null;
  }
  if (mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at++] !== 255) return null;
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 217 || marker === 218) return null;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (at + 2 > bytes.length) return null;
      const length = data.getUint16(at);
      if (length < 2 || at + length > bytes.length) return null;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) return length >= 7 ? size(data.getUint16(at+5),data.getUint16(at+3)) : null;
      at += length;
    }
  }
  if (mime === 'image/webp' && text(0,4) === 'RIFF' && text(8,4) === 'WEBP') {
    let at = 12;
    while (at + 8 <= bytes.length) {
      const kind = text(at,4), length = data.getUint32(at+4,true), start = at+8;
      if (start + length > bytes.length) return null;
      if (kind === 'VP8X' && length >= 10) return size(u24(start+4)+1,u24(start+7)+1);
      if (kind === 'VP8 ' && length >= 10 && bytes[start+3] === 157 && bytes[start+4] === 1 && bytes[start+5] === 42) return size(data.getUint16(start+6,true)&16383,data.getUint16(start+8,true)&16383);
      if (kind === 'VP8L' && length >= 5 && bytes[start] === 47) { const bits=data.getUint32(start+1,true); return size((bits&16383)+1,((bits>>>14)&16383)+1); }
      at = start + length + (length&1);
    }
  }
  if (mime === 'image/avif' && bytes.length >= 24 && text(4,4) === 'ftyp' && /avif|avis/.test(text(8,Math.min(40,bytes.length-8)))) {
    let largest=null;
    // ispe is the fixed 20-byte FullBox describing each AVIF image extent.
    for(let at=4;at+16<=bytes.length;at++) if(text(at,4)==='ispe' && data.getUint32(at-4)===20) { const candidate=size(data.getUint32(at+8),data.getUint32(at+12)); if(candidate&&(!largest||candidate.width*candidate.height>largest.width*largest.height))largest=candidate; }
    return largest;
  }
  return null;
})
