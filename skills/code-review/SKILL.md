# Skill: Code Review

Use when reviewing a change before it merges.

## Method

1. Read the task objective first, then the diff. A change that is correct but
   unrelated to the objective is still a finding.
2. For each suspected defect, construct the input that triggers it. If you
   cannot, label the finding unverified rather than dropping or asserting it.
3. Rank by severity: wrong results first, then crashes, then maintainability.

## Output

A findings list. Each entry: file, line, what breaks, and the failing case.
