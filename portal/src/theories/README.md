# Owner theories

Each theory is one module (`<theory-id>.js`) that follows the indicator
contract in `../indicators/` and is listed in `index.js`. Each theory gets one
section below, written **before** the code.

No theories have been added yet.

## Section template

Copy this block for each new theory.

```md
## <Theory name> (`<theory-id>`)

### Source
> Paste the owner's original text here, verbatim.

### Rules as implemented
- Inputs: close / high / low / volume
- Parameters (defaults): ...
- Applies to timeframes: ...
- State / entry condition: ...
- Exit / invalidation condition: ...
- Signal placement: the bar where the condition becomes knowable

### Open questions
- (asked the owner, waiting for an answer)

### Assumptions
- Assumption: ...

### Tests
- Fixture: `tests/fixtures/<theory-id>.json`, hand-checked values
- Look-ahead: truncating future bars does not change past output
```
