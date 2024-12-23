const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

function encode(value) {
  return encoder.encode(JSON.stringify(value));
}

function decode(valueBytes) {
  return JSON.parse(decoder.decode(valueBytes));
}

export {
  encode,
  decode,
  decoder,
};
