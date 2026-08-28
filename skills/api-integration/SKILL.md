# Skill: API Integration

Use when connecting our system to a third-party API.

## Method

1. Read the API documentation first and record the authentication method, the
   rate limits, and how pagination works.
2. Get one read call working before building anything on top of it.
3. Keep keys and tokens in environment variables. Nothing secret enters the
   workspace.
4. Handle pagination and retry before calling the integration done.

## Output

A working client, and the limits you found written down where the next person
will look.
