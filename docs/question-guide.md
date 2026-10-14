# Writing questions

Each file in `questions/` is a JSON array holding one category. Files load in name order, and that order sets the category order in the UI.
Run `npm run check-questions` after you edit a file. The server also checks every question when it starts and refuses to start if any question is invalid.

## Format

```json
{
  "id": "food-m-04",
  "category": "غذا و آشپزی",
  "difficulty": "medium",
  "question": "«کله‌جوش» در اصل با کدام فرآورده‌ی لبنی پخته می‌شود؟",
  "answer": "کشک",
  "distractors": ["دوغ", "ماست", "قره‌قوروت", "سرشیر", "پنیر محلی", "خامه", "کره‌ی حیوانی"],
  "explanation": "کله‌جوش غذایی ساده با کشک، پیاز داغ، نعناع داغ و گردو است."
}
```

- `answer` is the correct option, written as text. It is not an index.
- `distractors` must contain **7 or more** wrong options, ordered **most plausible first**. A room with 4 options always shows the first 2 distractors plus one more picked at random; a room with 6 options shows the first 3 plus two at random; a room with 8 options shows the first 7. Put the distractors that are hardest to rule out at the top of the list.
- `code` (optional) is a snippet shown left-to-right in a code block. `explanation` (optional) appears after the answer is revealed.
- An `id` is `<prefix>-<e|m|h>-<nn>` and must be unique across every file.

## What makes a good question

1. **One correct answer.** Each distractor has to be clearly wrong to someone who knows the fact, but believable to someone who doesn't. If you can argue that a distractor is also correct, replace it.
2. **Distractors match the answer.** They should be the same kind of thing at the same level of detail and about the same length: a player for a player, a club for a club, a year for a year, a dish from the same region or with similar ingredients, a studio for a studio. A football question never gets a fruit as an option.
3. **Never decide the answer by elimination alone.** Leave out joke options, options from another domain, and options that are obviously absurd. Every option should require real knowledge to rule out.
4. **Maths and logic:** build the distractors from common mistakes, such as the wrong order of operations, an off-by-one error, adding where you should multiply, forgetting to divide by 2, calculating a percentage of the wrong base, or a sign error. Every option must be a number written in the same format.
5. **Facts must be verified and stable.** Leave out anything you aren't sure of, along with records that are likely to change and phrasing like "currently". For recent facts, state the year, e.g. «در جام جهانی ۲۰۲۲». Avoid contested political or religious topics.
6. **Don't use "all of the above" or "none of the above"**, and avoid negative questions unless the word «نیست» is bold-obvious in the sentence.
7. **Difficulty:** _easy_ means most people know it, _medium_ needs some interest in the topic, and _hard_ is for enthusiasts or experts. A hard question gets hard distractors (near misses), not just a more obscure answer.
8. **Variety:** within a category, cover different sub-topics and question shapes (who, when, where, how many, which one, cause → effect, odd one out stated positively, short scenarios). Don't write near-duplicates that only swap one name.

## Persian style

- Use Persian letters «ی» and «ک», not the Arabic «ي» and «ك». The checker rejects the Arabic forms.
- Use a zero-width non-joiner (نیم‌فاصله, U+200C) where Persian needs one: «می‌شود»، «کتاب‌ها»، «خانه‌ی».
- End questions with «؟». Use «،» as the comma and «» as quotation marks.
- Write numbers in Persian text with Persian digits (۱۴۰۳، ۲۵٪). Keep technical tokens in Latin: code, commands, IPs, ports, versions, and HTTP codes. All options of a question must use one kind of digit; the checker enforces this.
- Write foreign names in common Persian spelling («لیونل مسی»، «زلدا»). Use Latin only when that is how Iranians actually write the term (`git`, `HTTP`, `FIFA`). When you do, keep the options consistent: either all of them are in Latin or all of them are in Persian.

## What the checker enforces

`npm run check-questions` (and server start-up) rejects a question that:
- is missing a field, has a bad difficulty or a duplicate id, or has fewer than 7 distractors;
- has duplicate options, comparing them after normalising spacing, ZWNJ, case, letter forms and digits;
- uses "all/none of the above" style options or Arabic letter forms;
- has a numeric answer with non-numeric distractors (or the reverse), or mixes Persian and Latin digits;
- has an answer that stands out by script (e.g. the only Latin option) or by length (much longer or shorter than every distractor).

The checker cannot judge relevance or truth. That is the author's job, and the reviewer's.
