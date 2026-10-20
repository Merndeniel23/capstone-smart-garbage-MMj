import { apiRequest } from "./api";

export const complaintApi = {
  async getAll() {
    return apiRequest("/complaints");
  },

  async create(data: any) {
    return apiRequest("/complaints", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async assign(id: number, collectorId: number) {
    return apiRequest(`/complaints/${id}/assign`, {
      method: "PUT",
      body: JSON.stringify({
        collectorId,
      }),
    });
  },

  async resolve(id: number, remarks: string) {
    return apiRequest(`/complaints/${id}/resolve`, {
      method: "PUT",
      body: JSON.stringify({
        remarks,
      }),
    });
  },
};