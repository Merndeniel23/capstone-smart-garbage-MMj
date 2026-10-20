import axios, { AxiosHeaders } from "axios";

const apiBaseURL = (import.meta.env?.VITE_API_BASE_URL?.trim() || "/api").replace(/\/+$/, "");

function getToken(): string {
  return localStorage.getItem("token") || sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") || sessionStorage.getItem("authToken") || "";
}

export const apiClient = axios.create({ baseURL: apiBaseURL });

apiClient.interceptors.request.use(config => {
  const token = getToken();
  if (token && !config.headers.has("Authorization")) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  return config;
});

function expireSession(status: number | undefined, authenticated: boolean) {
  if (status === 401 && authenticated) {
    window.dispatchEvent(new Event("auth-session-expired"));
  }
}

apiClient.interceptors.response.use(response => {
  expireSession(response.status, Boolean(response.config.headers.get("Authorization")));
  return response;
}, error => {
  if (axios.isAxiosError(error)) {
    expireSession(error.response?.status, Boolean(error.config?.headers?.get("Authorization")));
  }
  return Promise.reject(error);
});

// Compatibility bridge: existing screens keep their Response/json/blob handling,
// while all transport, API URL configuration and authentication use Axios.
export const apiFetch: typeof fetch = async (input, options = {}) => {
  const request = input instanceof Request ? input : null;
  const rawURL = request ? request.url : String(input);
  const url = new URL(rawURL, window.location.origin);
  const isAPI = url.origin === window.location.origin && /^\/api(?:\/|$)/.test(url.pathname);
  const endpoint = isAPI ? `${url.pathname.replace(/^\/api/, "") || "/"}${url.search}` : url.href;
  const headers = new Headers(request?.headers);
  new Headers(options.headers).forEach((value, name) => headers.set(name, value));
  const method = options.method || request?.method || "GET";
  const body = options.body !== undefined ? options.body :
    request && !/^(GET|HEAD)$/i.test(method) ? await request.clone().arrayBuffer() : undefined;
  const config = {
    url: endpoint,
    method,
    headers: AxiosHeaders.from(Object.fromEntries(headers.entries())),
    data: body,
    signal: options.signal || request?.signal || undefined,
    withCredentials: (options.credentials || request?.credentials) === "include",
    responseType: "arraybuffer" as const,
    validateStatus: () => true,
  };

  try {
    // Public map routing must never inherit the backend token or API base URL.
    const result = await (isAPI ? apiClient.request<ArrayBuffer>(config) : axios.request<ArrayBuffer>(config));
    const responseHeaders = new Headers();
    Object.entries(result.headers).forEach(([name, value]) => {
      if (value != null) responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : String(value));
    });
    return new Response([204, 205, 304].includes(result.status) || method.toUpperCase() === "HEAD" ? null : result.data, {
      status: result.status,
      statusText: result.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    if (axios.isCancel(error)) throw new DOMException("The request was aborted.", "AbortError");
    throw error;
  }
};
