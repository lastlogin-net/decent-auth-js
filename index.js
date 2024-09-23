import { fediversePage, completeMastodonLogin } from './fediverse.js';
import { oidcLogin, oidcCallback } from './oauth2.js';


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
    display: flex;
    justify-content: center;
  }

  .content {
    width: 640px;
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

const loginPageTmpl = (pathPrefix) => {
  return `
    ${headerTmpl}

    <h1>Login Page</h1>

    <form action=${pathPrefix}/login-fediverse>
      <label for='fediverse-id-input'>Fediverse ID</label>
      <input type='text' id='fediverse-id-input' name='id' />
      <button>Submit</button>
    </form>

    <form action=${pathPrefix}/login-oidc>
      <input type='hidden' id='oidc-provider-uri-input' name='provider_uri' value='https://lastlogin.net'/>
      <button>Login with LastLogin</button>
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
        return loginPage(pathPrefix);
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
      case '/login-oidc': {
        return oidcLogin(req, pathPrefix, kvStore);
        break;
      }
      case '/oidc-callback': {
        return oidcCallback(req, kvStore);
        break;
      }
      case '/login-fediverse': {
        const res = fediversePage(req, pathPrefix, kvStore);
        return res;
        break;
      }
      case '/callback': {
        return completeMastodonLogin(req, kvStore);
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

function loginPage(pathPrefix) {
  return sendHtml(loginPageTmpl(pathPrefix));
}



function sendHtml(html) {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
    },
  });
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



export default {
  createHandler,
  getSession,
  KvStore,
};
