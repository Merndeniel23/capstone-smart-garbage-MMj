import axios, { AxiosHeaders } from "axios";
import { apiClient } from "./http";

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  try {
    const response = await apiClient.request<T>({
      url: endpoint,
      method: options.method || "GET",
      data: options.body,
      headers: AxiosHeaders.from(Object.fromEntries(headers.entries())),
      signal: options.signal || undefined,
      withCredentials: options.credentials === "include",
    });
    return response.data;
  } catch (error) {
    if (axios.isCancel(error)) throw new DOMException("The request was aborted.", "AbortError");
    if (axios.isAxiosError<{ message?: string }>(error)) {
      if (["ECONNABORTED", "ETIMEDOUT"].includes(String(error.code))) {
        throw new Error("The server took too long to respond. Please refresh and try again.");
      }
      throw new Error(error.response?.data?.message || error.message || "API request failed.");
    }
    throw error;
  }
}
