# Skill: Research

Use before committing to an approach you do not yet understand.

## Method

1. Write the question down first, in one sentence, and bound it: what answer
   would let you stop looking?
2. Record the plan before searching. A plan you cannot write is a question you
   have not narrowed enough.
3. Try one thing at a time and record every attempt, **especially the ones that
   fail**. "Polling returned 429 after 40 requests" is the finding; the working
   approach is only half the value.
4. Stop when the question is answered, not when something works. Those differ.
5. Conclude into a proposal so the person decides whether it becomes knowledge.

## Commands

```bash
awb research start --question "..." --plan "..."
awb research attempt <id> --tried "..." --result failed --note "..."
awb research conclude <id> --text "..."
```

## Output

An answered question, an attempt log the next person can read, and a proposal
awaiting approval.
