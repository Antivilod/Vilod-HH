// This gate is repeated inside the self-contained browser injection function.
// A field's HTML type does not determine whether it accepts legal terms.
export function requiresUserDecision(question){
 return question?.type==='checkbox'||question?.requires_user_decision===true||
  /согласи[еяю]|соглас(?:ен|на|ны)|соглаша|принима(?:ю|ем|ете|ть).*(?:услов|оферт|договор)|подпис(?:ать|ыва|ание)|оферт|обработк.*(?:персональн|данн)|персональн.*данн|\b(?:i agree|i accept|consent|terms of service|privacy policy)\b/i.test(String(question?.text||''));
}
