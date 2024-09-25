import { genRandomText } from './utils.js';
import { generateChallengeData } from './oauth2.js';
import * as oauth from 'https://cdn.jsdelivr.net/npm/oauth4webapi@2.17.0/+esm'

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

async function atprotoLogin(req, pathPrefix, kvStore) {

  const url = new URL(req.url);
  const params = new URLSearchParams(url.search);

  const id = params.get('id');

  const didData = await resolveDid(id);
  const meta = await lookupAuthServer(didData);

  const cl = getClientMeta(req.url, pathPrefix);
  const redirectUri = cl.redirect_uris[0];

  const pkce = await generateChallengeData();

  const state = genRandomText(32);
  const authUri = `${meta.authorization_endpoint}?client_id=${cl.client_id}&redirect_uri=${redirectUri}&state=${state}&code_challenge=${pkce.challenge}&code_challenge_method=S256&response_type=code&scope=atproto`;

  const authReq = {
    id,
    did: didData.id,
    as: meta,
    client: cl,
    issuer: meta.issuer,
    codeVerifier: pkce.verifier,
    redirectUri,
  };

  await kvStore.set(`oauth_state/${state}`, authReq);

  return new Response(null, {
    status: 303,
    headers: {
      'Location': authUri,
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

  const dpopKeyPair = await oauth.generateKeyPair("RS256", {
    extractable: true,
  });

  const authorizationCodeGrantRequest = (dpopNonce) => {
    const dpop = {
      privateKey: dpopKeyPair.privateKey,
      publicKey: dpopKeyPair.publicKey,
      nonce: dpopNonce,
    };
    return oauth.authorizationCodeGrantRequest(
      authReq.as, authReq.client, params, authReq.redirectUri, authReq.codeVerifier, { DPoP: dpop });
  };

  let res = await authorizationCodeGrantRequest();

  let body = await res.json();

  if (!res.ok) {
    if (body.error === 'use_dpop_nonce') {
      const dpopNonce = res.headers.get('DPoP-Nonce');
      res = await authorizationCodeGrantRequest(dpopNonce);
    }
  }

  body = await res.json();

  if (!res.ok) {
    return new Response("Failed for some reason", {
      status: 500,
    });
  }

  if (body.sub !== authReq.did) {
    return new Response("Mismatched DIDs", {
      status: 400,
    });
  }

  const session = {
    userIdType: 'atproto',
    userId: authReq.id,
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

async function resolveDid(didDomain) {

  const did = await lookupDid(didDomain);

  if (!did.startsWith('did:plc')) {
    throw new Error("Unsupported did type: " + did);
  }

  const uri = `https://plc.directory/${did}`;
  const didDataRes = await fetch(uri);
  const didData = await didDataRes.json();

  return didData;
}

async function lookupDid(domain) {
  const didDomain = `_atproto.${domain}`;

  const res = await lookupDnsRecords(didDomain, 'TXT');

  let did;
  for (const record of res.Answer) {
    if (record.name === didDomain) {
      // TODO: not sure what format this is supposed to be
      const didTxt = JSON.parse(record.data);
      const didParts = didTxt.split('=');
      did = didParts[1];
      break;
    }
  }

  if (!did) {
    throw new Error("DID not found");
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

export {
  atprotoLogin,
  atprotoClientMetadata,
  atprotoCallback,
};
