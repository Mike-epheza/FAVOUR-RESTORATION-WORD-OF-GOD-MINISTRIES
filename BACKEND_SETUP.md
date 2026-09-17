# Backend setup

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`. The frontend and API are served by the same Express server.

## Configure M-Pesa

1. Create a Safaricom Daraja app and obtain the consumer key, consumer secret, shortcode, and passkey.
2. Copy `.env.example` to `.env`.
3. Fill in the `MPESA_*` values. For B2B, `MPESA_SECURITY_CREDENTIAL` must be the encrypted initiator credential provided for your Daraja app.
4. Set `MPESA_QUEUE_TIMEOUT_URL` and `MPESA_RESULT_URL` to public HTTPS URLs.
5. Use `MPESA_ENVIRONMENT=sandbox` while testing, then change it to `production` for live payments.

The callback URL must be reachable by Safaricom. For local testing, expose the server with a tunnel such as ngrok or Cloudflare Tunnel.

The B2B endpoint is for business-to-business transfers. It does not send a donor an STK PIN prompt; Safaricom sends the final result to `MPESA_RESULT_URL`.

## API endpoints

- `GET /api/health` checks that the backend is running.
- `POST /api/contact` stores contact form submissions.
- `POST /api/payment` submits an M-Pesa B2B payment request. Body: `{ "amount": 100 }`.
- `POST /api/donations` accepts the website donation payload.
- `POST /api/payment/callback` receives the Safaricom B2B result.

Never commit `.env`, consumer secrets, passkeys, or card details. Card payments should use a hosted checkout from a provider such as Paystack, Stripe, or Flutterwave; this backend deliberately does not collect raw card numbers.
