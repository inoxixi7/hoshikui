import { facingStar } from '../src/puzzle/rules';
import { normalize } from '../src/puzzle/math';
const ds: [string, [number,number,number]][] = [];
for (let az = 0; az < 360; az += 30) for (const el of [-60, -30, 0]) {
  const a = az*Math.PI/180, e = el*Math.PI/180;
  ds.push([`az${az} el${el}`, normalize([Math.cos(e)*Math.sin(a), Math.sin(e), Math.cos(e)*Math.cos(a)])]);
}
for (const [n, d] of ds) { const f = facingStar({ downNormal: d }); if (f[1] > 0.3) console.log(n, d.map(x=>x.toFixed(2)).join(','), '->', f.map(x=>x.toFixed(2)).join(',')); }
