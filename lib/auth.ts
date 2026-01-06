import { betterAuth } from "better-auth"

export const auth = betterAuth({
  database: {
    provider: "memory",
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    },
  },
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
})
