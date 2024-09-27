import { fediversePage, completeMastodonLogin } from './fediverse.js';
import { atprotoLogin, atprotoClientMetadata, atprotoCallback, lookupDid } from './atproto.js';
import { oidcLogin, oidcLoginWithMeta, oidcCallback } from './oidc.js';

class KvStore {
  constructor() {
    this._obj = {};
  }

  get(key) {
    return this._obj[key];
  }

  set(key, value) {
    this._obj[key] = value;
    this.persist();
  }

  list(keyPrefix) {
    const results = [];

    for (const key in this._obj) {
      if (key.startsWith(keyPrefix)) {
        results.push(this._obj[key]);
      }
    }

    return results;
  }

  delete(keyPrefix) {
    for (const key in this._obj) {
      if (key.startsWith(keyPrefix)) {
        delete this._obj[key];
      }
    }

    this.persist();
  }

  persist() {
    // noop
    console.log(this._obj);
  }
}



const stylesTmpl = `
  body {
    font-family: Arial;
    font-size: 1.2em;
    display: flex;
    justify-content: center;
  }

  .content {
    width: 640px;
  }

  .hidden {
    display: none;
  }

  .details-label {
    user-select: none;
    cursor: pointer;
    padding: 0px 3px;
    border: 1px solid #000;
    border-radius: 4px;
  }

  .details {
    padding: 10px;
    border: 1px solid #000;
    border-radius: 5px;
    margin-bottom: 20px;
  }

  input:not(:checked) + .details {
    display: none;
  }

  .error {
    color: red;
  }
`;

const headerTmpl = `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1" />

      <style>
        ${stylesTmpl}
      </style>
    </head>
    <body>
      <main class='content'>
`;

const footerTmpl = `
      </main>
    </body>
  </html>
`;

const loginPageTmpl = (errorMessage, pathPrefix) => {

  let errHtml = '';
  if (errorMessage) {
    errHtml = `
      <p class='error'>
        ${escapeHtml(errorMessage)}
      </p>
    `;
  };

  return `
    ${headerTmpl}

    <h1>Login Page</h1>

    <p>
      To login, enter an identifier or identity server
      <label class='details-label' for='details-checkbox'>?</label>
    </p>

    <input id='details-checkbox' type='checkbox' class='hidden' />
    <div class='details'>
      <p>
        In the examples below, "<code>example.com</code>" is a stand-in for your own domain.
      </p>
      <p>
        Example identifiers:
      </p>
      <ul>
        <li>Fediverse ID (<code>@user@mastodon.social</code>, <code>@user@example.com</code>)</li>
        <li>ATProto ID (<code>user.bsky.social</code>, <code>example.com</code>, <code>did:plc:abc123...</code>)</li>
        <!--
        <li>IndieAuth URL (<code>example.com</code>, <code>example.com/user</code>)</li>
        -->
        <li>Email address (<code>user@example.com</code>)</li>
      </ul>

      <p>
        Example identity servers:
      </p>
      <ul>
        <li>OpenID Connect server (<code><a href='https://lastlogin.net'>LastLogin.net</a></code>, <code>example.com</code>)</li>
        <li>ATProto PDS (<code><a href='https://bsky.social'>bsky.social</a></code>, <code>example.com</code>)</li>
        <!-- TODO: Find out if IndieAuth actually supports server-first flows
        <li>IndieAuth server (IndieAuth.com, example.com)</li>
        -->
      </ul>
    </div>

    ${errHtml}

    <form action=${pathPrefix}/initiate>
      <input type='text' id='login-input' name='value' placeholder='lastlogin.net' />
      <button>Login</button>
    </form>

    ${footerTmpl}
  `;
};

async function getSession(req, kvStore) {
  const sessionKey = getCookie(req, 'session_key');
  return await kvStore.get(`sessions/${sessionKey}`)
}

function createHandler(kvStore, opt) {

  let pathPrefix = opt?.prefix;

  async function handler(req) {

    const url = new URL(req.url);

    const pathname = url.pathname.slice(pathPrefix.length);
    const path = pathname ? pathname : '/';

    switch (path) {
      case '/': {
        return loginPage(url, pathPrefix);
        break;
      }
      case '/logout': {

        const sessionKey = getCookie(req, 'session_key');
        await kvStore.delete(`sessions/${sessionKey}`)

        return new Response(null, {
          status: 303,
          headers: {
            'Location': '/',
            'Set-Cookie': `session_key=''; Path=/; Max-Age=0; Secure; HttpOnly`,
          },
        });

        break;
      }
      case '/initiate': {
        return login(req, pathPrefix, kvStore);
        break;
      }
      case '/oidc-callback': {
        return oidcCallback(req, kvStore);
        break;
      }
      case '/atproto-callback': {
        return atprotoCallback(req, pathPrefix, kvStore);
        break;
      }
      case '/fediverse-callback': {
        return completeMastodonLogin(req, kvStore);
        break;
      }
      case '/client-metadata.json': {
        return atprotoClientMetadata(req, pathPrefix);
        break;
      }
      default: {
        return new Response("Not found", { status: 404 });
        break;
      }
    }
  }

  return handler;
}

function loginPage(url, pathPrefix) {
  const errorMessage = url.searchParams.get('error');
  return sendHtml(loginPageTmpl(errorMessage, pathPrefix));
}

function sendHtml(html) {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
    },
  });
}

async function login(req, pathPrefix, kvStore) {
  const url = new URL(req.url);
  const params = new URLSearchParams(url.search);

  const value = params.get('value');

  if (!value) {
    const providerUri = 'https://lastlogin.net';
    return oidcLogin(req, pathPrefix, kvStore, providerUri);
  }

  if (value.startsWith('did:plc')) {
    // atproto shortcut
    const did = value;
    return atprotoLogin(req, pathPrefix, kvStore, did);
  }

  const parts = value.split('@');

  if (parts.length === 3) {
    // fediverse
    const id = value;
    return fediversePage(req, pathPrefix, kvStore, id);
  }
  else if (parts.length === 2) {
    // email. always use LastLogin for now
    const providerUri = 'https://lastlogin.net';
    return oidcLogin(req, pathPrefix, kvStore, providerUri);
  }
  else {
    // URL
    if (value.includes('lastlogin.net')) {
      const providerUri = 'https://lastlogin.net';
      return oidcLogin(req, pathPrefix, kvStore, providerUri);
    }

    const parsedUrl = normalizeUrl(value);
    if (!parsedUrl) {
      return resetWithError(pathPrefix, `Could not convert '${value}' into an identifier or server address`);
    }

    if (parsedUrl.pathname && parsedUrl.pathname !== '/') {
      return resetWithError(pathPrefix, `Failed to log in with '${value}'. URL paths ('${parsedUrl.pathname}') are not currently supported`);
    }

    // Either atproto or OIDC
    const domain = parsedUrl.hostname;
    const proto = await protoDiscovery(domain);

    if (!proto) {
      return resetWithError(pathPrefix, `Failed to find a compatible login method for '${domain}'`);
    }

    if (proto.type === 'atproto') {
      return atprotoLogin(req, pathPrefix, kvStore, proto);
    }
    else if (proto.type === 'oidc') {
      const providerUri = domain;
      return oidcLoginWithMeta(req, pathPrefix, kvStore, proto.meta);
    }
  }

  return resetWithError(pathPrefix, `Invalid input`);
}

function resetWithError(pathPrefix, errorMessage) {
  return new Response(null, {
    status: 303,
    headers: {
      'Location': `${pathPrefix}?error=${errorMessage}`,
    },
  });
}

function normalizeUrl(value) {

  if (!value.includes('.')) {
    return null;
  }

  const parsedUrl = value.startsWith('http') ? new URL(value) : new URL('https://' + value);

  return parsedUrl;
}

async function protoDiscovery(domain) {
  const didPromise = lookupDid(domain);
  const oidcMetaPromise = fetch(`https://${domain}/.well-known/openid-configuration`)
    .then(res => {
      if (!res.ok) {
        return null;
      }
      return res.json();
    })
    .catch(e => {
      return null;
    });
  const oauth2MetaPromise = fetch(`https://${domain}/.well-known/oauth-authorization-server`)
    .then(res => {
      if (!res.ok) {
        return null;
      }

      return res.json();
    })
    .catch(e => {
      return null;
    });
    

  const results = await Promise.all([ didPromise, oidcMetaPromise, oauth2MetaPromise ]);

  if (results[0]) {
    return {
      type: 'atproto',
      did: results[0],
    };
  }
  else if (results[1]) {
    return {
      type: 'oidc',
      meta: results[1],
    };
  }
  else if (results[2]) {
    return {
      type: 'atproto',
      authServerMeta: results[2],
    };
  }
  else {
    return null;
  }
}

function getCookie(req, name) {

  const cookiesText = req.headers.get('cookie');

  if (!cookiesText) {
    return null;
  }

  const allCookiesParts = cookiesText.split(';');

  for (const cookie of allCookiesParts) {
    const cookieText = cookie.trim();
    const cookieParts = cookieText.split('=');

    if (cookieParts[0] === name) {
      return cookieParts.slice(1).join('=');
    }
  }
}

// From https://stackoverflow.com/a/6234804/943814
const escapeHtml = (unsafe) => {
    return unsafe.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}



export default {
  createHandler,
  getSession,
  KvStore,
};
