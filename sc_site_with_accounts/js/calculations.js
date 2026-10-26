function requiredKv(q,dp,sg){if(![q,dp,sg].every(x=>Number.isFinite(x)&&x>0))return null;const v=q*Math.sqrt(sg/dp);return Number.isFinite(v)?v:null}
