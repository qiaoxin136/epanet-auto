import { defineStorage } from "@aws-amplify/backend";

export const storage = defineStorage({
  name: "epanetInpStorage",
  access: (allow) => ({
    "inp-files/*": [
      allow.guest.to(["read", "write", "delete"]),
      allow.authenticated.to(["read", "write", "delete"]),
    ],
  }),
});
