function genRandomText(len) {
  const possible = "0123456789abcdefghijkmnpqrstuvwxyz";

  let text = "";
  for (let i = 0; i < len; i++) {
    const randIndex = Math.floor(Math.random() * possible.length);
    text += possible[randIndex];
  }

  return text;
}

function parseAndVerifyJwt(jwtText, expectedIssuer, expectedAudience) {
  const jwt = parseJwt(jwtText);

  if (expectedIssuer !== jwt.claims.iss) {
    throw new Error("Issuer mismatch");
  }

  let audMatch = false;
  if (Array.isArray(jwt.claims.aud)) {
    for (const aud of jwt.claims.aud) {
      if (aud === expectedAudience) {
        audMatch = true;
        break;
      }
    }
  }
  else {
    audMatch = jwt.claims.aud === expectedAudience;
  }

  if (!audMatch) {
    throw new Error("Audience mismatch");
  }

  return jwt;
}

// Parses JWT without verifying signature. Must be used over HTTPS
function parseJwt(jwtText, iss, aud) {
  const jwtParts = jwtText.split('.');
  
  if (jwtParts.length !== 3) {
    throw new Error("Invalid JWT");
  }

  const header = JSON.parse(atob(jwtParts[0]));
  const claims = JSON.parse(atob(jwtParts[1]));
  const signature = jwtParts[2];

  return {
    header,
    claims,
    signature,
  };
}

export {
  genRandomText,
  parseAndVerifyJwt,
};
