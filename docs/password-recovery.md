# Password recovery configuration

The admin recovery flow uses a single-use, SHA-256-hashed token stored on the admin record for 30 minutes. The forgot-password endpoint always returns the same response whether or not an account exists, and the reset endpoint clears the token after a successful password change.

Configure these environment variables on the Render backend before testing real email delivery:

| Variable | Purpose |
| --- | --- |
| `SMTP_HOST` | SMTP provider hostname. |
| `SMTP_PORT` | SMTP port; defaults to `587`, while port `465` uses implicit TLS. |
| `SMTP_USER` | SMTP account username. |
| `SMTP_PASSWORD` | SMTP account password or provider-issued app password. |
| `SMTP_FROM` | Optional verified sender address; defaults to `SMTP_USER`. |
| `ADMIN_APP_URL` | Optional admin origin; defaults to `https://timavelle-cuisine-admin.vercel.app`. |

Do not commit these values to Git or expose them in Vercel frontend variables. After adding them in Render, request a password reset from the admin login page and confirm that the email link opens `/reset-password/:token`, expires after 30 minutes, and cannot be reused. If SMTP is not configured, the endpoint intentionally keeps the generic anti-enumeration response but does not send an email.
