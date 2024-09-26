import { genRandomText } from './utils.js';
import { generateChallengeData } from './oauth2.js';
import * as oauth from 'https://cdn.jsdelivr.net/npm/oauth4webapi@2.17.0/+esm'

// This code borrowed heavily from frontpage.fyi's implementation

async function atprotoClientMetadata(req, pathPrefix) {

  const clientMeta = getClientMeta(req.url, pathPrefix);

  return new Response(JSON.stringify(clientMeta), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function getClientMeta(unparsedUrl, pathPrefix) {

  const url = new URL(unparsedUrl);

  const clientMeta = {
    client_id: `https://${url.hostname}${pathPrefix}/client-metadata.json`,
    application_type: 'web',
    client_name: 'Decent Auth Client',
    client_uri: `https://${url.hostname}`,
    dpop_bound_access_tokens: true,
    grant_types: [
      'authorization_code',
      'refresh_token',
    ],
    redirect_uris: [
      `https://${url.hostname}${pathPrefix}/atproto-callback`,
    ],
    response_types: [
      'code'
    ],
    scope: 'atproto',
    token_endpoint_auth_method: 'none',
  };

  return clientMeta;
}

async function atprotoLogin(req, pathPrefix, kvStore, config) {

  let handle;
  let as;
  let did;
  if (config.did) {
    did = config.did;
    const didData = await resolveDid(did);
    handle = didData.alsoKnownAs[0].split('at://')[1];
    as = await lookupAuthServer(didData);
  }
  else {
    as = config.authServerMeta;
  }

  const cl = getClientMeta(req.url, pathPrefix);
  const redirectUri = cl.redirect_uris[0];

  const pkce = await generateChallengeData();

  const state = genRandomText(32);
  const authUri = `${as.authorization_endpoint}?client_id=${cl.client_id}&redirect_uri=${redirectUri}&state=${state}&code_challenge=${pkce.challenge}&code_challenge_method=S256&response_type=code&scope=atproto`;

  const dpopKeyPair = await oauth.generateKeyPair("RS256", {
    extractable: true,
  });

  const params = {
    response_type: "code",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    client_id: cl.client_id,
    state,
    redirect_uri: cl.redirect_uris[0],
    scope: cl.scope,
  }

  if (handle) {
    params.login_hint = handle;
  }

  const makeParRequest = async (dpopNonce) => {
    return oauth.pushedAuthorizationRequest(
      as,
      cl,
      params,
      {
        DPoP: {
          privateKey: dpopKeyPair.privateKey,
          publicKey: dpopKeyPair.publicKey,
          nonce: dpopNonce,
        },
      },
    );
  };

  let res = await makeParRequest();

  let par = await res.json();

  let dpopNonce;

  if (!res.ok) {
    if (par.error === 'use_dpop_nonce') {
      dpopNonce = res.headers.get('DPoP-Nonce');
      res = await makeParRequest(dpopNonce);
      par = await res.json();
    }
  }

  const authReq = {
    handle,
    did,
    as,
    client: cl,
    codeVerifier: pkce.verifier,
    redirectUri,
    dpopPrivateJwk: JSON.stringify(
      await crypto.subtle.exportKey("jwk", dpopKeyPair.privateKey),
    ),
    dpopPublicJwk: JSON.stringify(
      await crypto.subtle.exportKey("jwk", dpopKeyPair.publicKey),
    ),
    dpopNonce,
  };

  await kvStore.set(`oauth_state/${state}`, authReq);

  const redirUri = new URL(as.authorization_endpoint);
  redirUri.searchParams.set('request_uri', par.request_uri);
  redirUri.searchParams.set('client_id', cl.client_id);

  return new Response(null, {
    status: 303,
    headers: {
      'Location': redirUri.toString(),
    },
  });
}

async function atprotoCallback(req, pathPrefix, kvStore) {

  const url = new URL(req.url);
  const paramsState = new URLSearchParams(url.search);

  const state = paramsState.get('state');
  if (!state) {
    return new Response("Missing state param", {
      status: 400,
    });
  }

  const authReq = await kvStore.get(`oauth_state/${state}`);
  await kvStore.delete(`oauth_state/${state}`);

  if (!authReq) {
    throw new Error("No such auth request");
  }

  const params = oauth.validateAuthResponse(authReq.as, authReq.client, url, state);
  if (oauth.isOAuth2Error(params)) {
    console.error('Error Response', params)
    throw new Error()
  }

  const { privateKey, publicKey } = await importJwks(authReq.dpopPrivateJwk, authReq.dpopPublicJwk); 

  const authorizationCodeGrantRequest = (dpopNonce) => {
    const dpop = {
      privateKey,
      publicKey,
      nonce: dpopNonce,
    };
    return oauth.authorizationCodeGrantRequest(
      authReq.as, authReq.client, params, authReq.redirectUri, authReq.codeVerifier, { DPoP: dpop });
  };

  let res = await authorizationCodeGrantRequest(authReq.dpopNonce);

  let body = await res.json();

  if (!res.ok) {
    if (body.error === 'use_dpop_nonce') {
      const dpopNonce = res.headers.get('DPoP-Nonce');
      res = await authorizationCodeGrantRequest(dpopNonce);
      body = await res.json();
    }
  }

  if (!res.ok) {
    return new Response("Failed for some reason", {
      status: 500,
    });
  }

  const did = body.sub;

  if (authReq.did && authReq.did !== did) {
    return new Response("Mismatched DIDs", {
      status: 400,
    });
  }

  let handle = authReq.handle;
  if (!handle) {
    const didData = await resolveDid(did);
    handle = didData.alsoKnownAs[0].split('at://')[1];
  }

  const session = {
    userIdType: 'atproto',
    userId: handle,
  };

  const sessionKey = genRandomText(32);
  await kvStore.set(`sessions/${sessionKey}`, session);

  return new Response(null, {
    status: 303,
    headers: {
      'Location': '/',
      'Set-Cookie': `session_key=${sessionKey}; Path=/; Max-Age=84600; Secure; HttpOnly`,
    },
  });
}

async function lookupAuthServer(didData) {
  const uri = `${didData.service[0].serviceEndpoint}/.well-known/oauth-protected-resource`;
  const res = await fetch(uri);
  const data = await res.json();
  const authServer = data.authorization_servers[0];

  const issuer = new URL(authServer);
  const as = await oauth
    .discoveryRequest(issuer, { algorithm: 'oauth2' })
    .then((response) => oauth.processDiscoveryResponse(issuer, response))

  return as;
}

async function resolveDid(did) {

  if (!did.startsWith('did:plc')) {
    throw new Error("Unsupported did type: " + did);
  }

  const uri = `https://plc.directory/${did}`;
  const didDataRes = await fetch(uri);
  const didData = await didDataRes.json();

  return didData;
}

async function lookupDid(domain) {

  const dnsPromise = lookupDidDns(domain);
  const httpPromise = lookupDidHttp(domain);

  let did = await Promise.any([ dnsPromise, httpPromise ]);

  if (!did) {
    const results = await Promise.all([ dnsPromise, httpPromise ]);
    did = results[0] ? results[0] : results[1];
  }

  return did;
}

async function lookupDidHttp(domain) {
  const uri = `https://${domain}/.well-known/atproto-did`;
  const res = await fetch(uri);

  if (!res.ok) {
    return null;
  }

  const did = await res.text();
  return did;
}

async function lookupDidDns(domain) {

  const verifDomain = `_atproto.${domain}`;

  const res = await lookupDnsRecords(verifDomain, 'TXT');

  let did;

  if (!res.Answer || res.Answer.length < 1) {
    return null;
  }

  for (const record of res.Answer) {
    if (record.name === verifDomain) {
      // TODO: not sure what format this is supposed to be
      const didTxt = JSON.parse(record.data);
      const didParts = didTxt.split('=');
      did = didParts[1];
      break;
    }
  }

  return did;
}

const dohServer = 'https://cloudflare-dns.com';
async function lookupDnsRecords(domain, type) {
  const uri = `${dohServer}/dns-query?name=${domain}&type=${type}`;
  const recRes = await fetch(uri, {
    headers: {
      'Accept': 'application/dns-json',
    },
  });
  const recs = await recRes.json();
  return recs;
}

async function importJwks(privateJwk, publicJwk) {
  const [privateKey, publicKey] = await Promise.all([
    crypto.subtle.importKey(
      "jwk",
      JSON.parse(privateJwk),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      true,
      ["sign"],
    ),
    crypto.subtle.importKey(
      "jwk",
      JSON.parse(publicJwk),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      true,
      ["verify"],
    ),
  ]);

  return {
    publicKey,
    privateKey,
  };
}

export {
  atprotoLogin,
  atprotoClientMetadata,
  atprotoCallback,
  lookupDid,
};
