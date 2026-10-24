# Security

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/pmadruga/thunderai-sidebar/security/advisories/new) if it is enabled for this repository. If that form is unavailable, contact the maintainer through [pedromadruga.com](https://pedromadruga.com/) and ask for a private reporting channel before sending sensitive details. Do not open a public issue containing an exploit, credentials, email content or a private transcript.

Include the fork version, Thunderbird version, operating system, affected component, and a minimal reproduction using synthetic email. Describe impact and prerequisites. Do not attach a real Thunderbird profile, raw settings export or unredacted debug log.

Only the most recent fork release receives security fixes. There is no guaranteed response time. A disclosure date should be agreed with the maintainer before publication.

## Security boundaries

This add-on uses privileged Thunderbird Experiment APIs. Those APIs can access Thunderbird internals and bypass ordinary WebExtension permission boundaries. Its optional-permission controls must not be treated as a sandbox around the add-on itself.

Emails, model responses, attachments, tool arguments and provider errors are untrusted data. Test these boundaries using local mock APIs and disposable profiles. Do not test against real mail accounts or live task data without explicit authorization.

Encrypted local chat history protects the saved transcript at rest using Thunderbird's native key store. It is not protection from malicious software running as your logged-in user, an unlocked Thunderbird session, compromised extension code, or the selected AI provider. See [PRIVACY.md](PRIVACY.md).

## Release checks

Run the automated checks, a redacted secret scan of the intended history, and disposable-profile Thunderbird smoke tests before a release. CI uses read-only permissions and SHA-pinned actions; tests run without production credentials. Never publish an XPI built from an unreviewed workspace or include local backups in an artifact.
