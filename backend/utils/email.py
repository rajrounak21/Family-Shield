from email.message import EmailMessage

import aiosmtplib

from core.config import settings


async def send_verification_email(
    recipient_email: str,
    recipient_name: str,
    code: str,
):
    """Branded verification email carrying a 6-digit code."""
    first = (recipient_name or "there").split(" ")[0]

    message = EmailMessage()
    message["From"] = settings.email_from or settings.smtp_username
    message["To"] = recipient_email
    message["Subject"] = f"Your FamilyShield verification code: {code}"

    plain_text = f"""
Hello {first},

Welcome to FamilyShield! Please verify your email address with this code:

    {code}

Enter it in the app to finish setting up your account.
This code expires in 15 minutes.

If you did not create a FamilyShield account, you can safely ignore this email.

Regards,
FamilyShield Team
"""
    message.set_content(plain_text)

    digits = "".join(
        f"""<td align="center" style="width: 52px; height: 60px; background-color: #ecfdf5; border: 2px solid #10b981; border-radius: 12px; font-size: 28px; font-weight: 800; color: #065f46; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">{d}</td>"""
        for d in code
    )

    html_content = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f0f2f1;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f0f2f1;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">

                    <!-- Brand header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #059669, #10b981); padding: 40px 40px 32px; text-align: center;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-bottom: 20px;">
                                <tr>
                                    <td style="width: 64px; height: 64px; background-color: rgba(255,255,255,0.2); border-radius: 16px; text-align: center; vertical-align: middle;">
                                        <svg viewBox="0 0 48 48" width="40" height="40" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M24 4 40 10v12c0 10.3-6.6 18.9-16 22-9.4-3.1-16-11.7-16-22V10L24 4Z" fill="white" opacity="0.9"/>
                                            <path d="M20 24.5 27 31.5 33 19.5" stroke="#10b981" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
                                        </svg>
                                    </td>
                                </tr>
                            </table>
                            <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">
                                FamilyShield
                            </h1>
                            <p style="margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 14px; font-weight: 500;">
                                One step left — verify your email
                            </p>
                        </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                        <td style="padding: 40px;">
                            <h2 style="margin: 0 0 8px; color: #0e1210; font-size: 20px; font-weight: 700;">
                                Hello {first}, welcome aboard!
                            </h2>
                            <p style="margin: 0 0 28px; color: #5a6560; font-size: 15px; line-height: 1.6;">
                                Enter this code in the app to verify your email and unlock your family safety dashboard:
                            </p>

                            <!-- Code boxes -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 0 auto 8px;">
                                <tr>
                                    <td style="padding: 0 4px;">{digits}</td>
                                </tr>
                            </table>
                            <p style="margin: 0 0 28px; text-align: center; color: #9ca3af; font-size: 12px;">
                                Type the 6 digits exactly as shown
                            </p>

                            <!-- What's next -->
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 28px;">
                                <tr>
                                    <td style="background-color: #ecfdf5; border-radius: 12px; padding: 16px 20px;">
                                        <p style="margin: 0 0 8px; color: #065f46; font-size: 14px; font-weight: 700;">
                                            What happens next?
                                        </p>
                                        <p style="margin: 0; color: #047857; font-size: 13px; line-height: 1.7;">
                                            1 &nbsp;Enter the code in the app<br>
                                            2 &nbsp;Set up your profile in onboarding<br>
                                            3 &nbsp;Create or join your family &#127968;
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Expiry -->
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                                <tr>
                                    <td style="background-color: #fef3c7; border-radius: 8px; padding: 12px 16px;">
                                        <p style="margin: 0; color: #92400e; font-size: 13px; line-height: 1.5;">
                                            &#9200; <strong>This code expires in 15 minutes.</strong> Need a new one? Just tap Resend in the app.
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin: 24px 0 0; color: #5a6560; font-size: 13px; line-height: 1.6;">
                                If you didn't create a FamilyShield account, you can safely ignore this email.
                            </p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f9fafb; padding: 24px 40px; border-top: 1px solid #e5e7eb;">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                                <tr>
                                    <td style="text-align: center;">
                                        <p style="margin: 0 0 8px; color: #5a6560; font-size: 12px;">
                                            &copy; 2026 FamilyShield. Protecting families from digital threats.
                                        </p>
                                        <p style="margin: 0; color: #9ca3af; font-size: 11px;">
                                            This is a security email. Please do not reply.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>
"""
    message.add_alternative(html_content, subtype="html")

    await aiosmtplib.send(
        message,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_username,
        password=settings.smtp_password,
        start_tls=True,
    )


async def send_password_reset_email(
    recipient_email: str,
    reset_link: str,
):
    message = EmailMessage()

    message["From"] = settings.email_from or settings.smtp_username
    message["To"] = recipient_email
    message["Subject"] = "Reset your FamilyShield password"

    # Plain text fallback
    plain_text = f"""
Hello,

We received a request to reset your FamilyShield password.

Click the link below to create a new password:

{reset_link}

This link will expire in {settings.password_reset_expire_minutes} minutes.

If you did not request a password reset, you can safely ignore this email.

Regards,
FamilyShield Team
"""
    message.set_content(plain_text)

    # HTML email with branding
    html_content = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f0f2f1;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f0f2f1;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <!-- Main Card -->
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">
                    
                    <!-- Header with gradient -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #059669, #10b981); padding: 40px 40px 32px; text-align: center;">
                            <!-- Shield Icon -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-bottom: 20px;">
                                <tr>
                                    <td style="width: 64px; height: 64px; background-color: rgba(255,255,255,0.2); border-radius: 16px; text-align: center; vertical-align: middle;">
                                        <svg viewBox="0 0 48 48" width="40" height="40" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M24 4 40 10v12c0 10.3-6.6 18.9-16 22-9.4-3.1-16-11.7-16-22V10L24 4Z" fill="white" opacity="0.9"/>
                                            <path d="M16 24h16M24 16v16" stroke="#10b981" stroke-width="4" stroke-linecap="round"/>
                                        </svg>
                                    </td>
                                </tr>
                            </table>
                            <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">
                                FamilyShield
                            </h1>
                            <p style="margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 14px; font-weight: 500;">
                                Password Reset Request
                            </p>
                        </td>
                    </tr>

                    <!-- Body Content -->
                    <tr>
                        <td style="padding: 40px;">
                            <h2 style="margin: 0 0 16px; color: #0e1210; font-size: 20px; font-weight: 700;">
                                Reset your password
                            </h2>
                            <p style="margin: 0 0 24px; color: #5a6560; font-size: 15px; line-height: 1.6;">
                                We received a request to reset the password for your FamilyShield account. Click the button below to create a new password.
                            </p>

                            <!-- CTA Button -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 0 auto 32px;">
                                <tr>
                                    <td style="border-radius: 12px; background: linear-gradient(135deg, #10b981, #059669); box-shadow: 0 4px 16px rgba(16, 185, 129, 0.3);">
                                        <a href="{reset_link}" target="_blank" style="display: inline-block; padding: 16px 48px; color: #ffffff; font-size: 16px; font-weight: 700; text-decoration: none; letter-spacing: 0.3px;">
                                            Reset Password
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <!-- Divider -->
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                                <tr>
                                    <td style="border-top: 1px solid #e5e7eb; height: 1px;"></td>
                                </tr>
                            </table>

                            <!-- Link fallback -->
                            <p style="margin: 24px 0; color: #5a6560; font-size: 13px; line-height: 1.5;">
                                If the button doesn't work, copy and paste this link into your browser:
                            </p>
                            <p style="margin: 0; padding: 12px 16px; background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb; word-break: break-all;">
                                <a href="{reset_link}" style="color: #059669; font-size: 13px; text-decoration: none;">{reset_link}</a>
                            </p>

                            <!-- Expiry notice -->
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 24px;">
                                <tr>
                                    <td style="background-color: #fef3c7; border-radius: 8px; padding: 12px 16px;">
                                        <p style="margin: 0; color: #92400e; font-size: 13px; line-height: 1.5;">
                                            ⏰ <strong>This link will expire in {settings.password_reset_expire_minutes} minutes.</strong>
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Security notice -->
                            <p style="margin: 24px 0 0; color: #5a6560; font-size: 13px; line-height: 1.6;">
                                If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
                            </p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f9fafb; padding: 24px 40px; border-top: 1px solid #e5e7eb;">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                                <tr>
                                    <td style="text-align: center;">
                                        <p style="margin: 0 0 8px; color: #5a6560; font-size: 12px;">
                                            © 2026 FamilyShield. Protecting families from digital threats.
                                        </p>
                                        <p style="margin: 0; color: #9ca3af; font-size: 11px;">
                                            This is a security email. Please do not reply.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>
"""
    message.add_alternative(html_content, subtype="html")

    await aiosmtplib.send(
        message,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_username,
        password=settings.smtp_password,
        start_tls=True,
    )
