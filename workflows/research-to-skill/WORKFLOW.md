# Workflow: Research to Skill

Turning something you had to figure out into something nobody has to figure out
again.

1. `awb research start --question "..."` — bound the question before searching.
2. `awb research attempt <id> --tried "..." --result ...` after each try.
   Record the failures; they are what save the next person time.
3. `awb research conclude <id> --text "..."` when the question is answered.
4. `awb memory approve <proposal-id>` — you decide whether it becomes knowledge.
5. If the approach is worth repeating, write it up as a skill:
   `skills/<id>/SKILL.md` for the method and `skills/<id>/skill.json` for the
   contract. `useWhen` is the field that lets an agent pick it later, so write
   that one for a reader who does not already know what the skill does.
6. `awb validate` — a malformed contract is an error, a missing one a warning.
7. If it should be shared, open a pull request against the distribution. The
   maintainer decides what the whole team carries.

Do not promote after one success. A skill is a claim that the approach works
again.
