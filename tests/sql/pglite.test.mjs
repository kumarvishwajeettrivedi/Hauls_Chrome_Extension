import {PGlite} from '@electric-sql/pglite';
import fs from 'fs';
import {fileURLToPath} from 'url'; import path from 'path';
const M=path.join(path.dirname(fileURLToPath(import.meta.url)),'../../supabase/migrations/');
const db=new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz default now()); -- confirmed by default; 0018 tests insert unconfirmed ones explicitly
create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
`);
await db.exec(`create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
create table public.waitlist(id uuid default gen_random_uuid(), email text, created_at timestamptz default now(), source text);
grant usage on schema public, auth to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated;`);
for (const f of ['0001_ext_core','0002_ext_functions','0003_ext_rls','0004_ext_hardening','0005_ext_review_fixes','0006_ext_security_review','0007_ext_user_settings','0008_ext_settings_places','0009_ext_history_privacy','0010_ext_chart_series','0011_ext_obs_src_bg','0012_ext_feedback','0013_ext_watchlist_deletion','0014_ext_price_alert_email','0015_ext_hardening','0016_ext_profile_input_checks','0017_ext_security_hardening','0018_ext_security_followup','0019_ext_waitlist_confirmed_email','0020_ext_observation_retention']) { await db.exec(fs.readFileSync(M+f+'.sql','utf8')); await db.exec(fs.readFileSync(M+f+'.sql','utf8')); } // twice = idempotent
let ok=true; const T=(n,c,d)=>{console.log(c?'PASS':'FAIL',n,c||!d?'':'-> '+d); if(!c) ok=false;};
const as=async(uid,fn)=>{await db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', false)`); try{return await fn()} finally{await db.exec(`reset role`)}};
const fails=async p=>{try{await p;return false}catch(e){return true}};
const A=(await db.query(`insert into auth.users(email,raw_user_meta_data) values('a@x.t','{"full_name":"Al","picture":"p"}') returning id`)).rows[0].id;
const B=(await db.query(`insert into auth.users(email) values('b@x.t') returning id`)).rows[0].id;
const C=(await db.query(`insert into auth.users(email) values('c@x.t') returning id`)).rows[0].id;
T('new users default to contribute=false (opt-in)', (await db.query(`select bool_and(contribute=false) b from ext_profiles`)).rows[0].b===true);
await db.exec('update public.ext_profiles set contribute=true'); // simulate opt-in for the scenarios below
T('profile trigger', (await db.query(`select name,avatar_url,plan from public.ext_profiles where id='${A}'`)).rows[0]?.name==='Al');
await as(A,()=>db.query(`insert into ext_watchlist(product_key,title) values('k1','t')`));
T('B cannot see A watchlist', (await as(B,()=>db.query(`select * from ext_watchlist`))).rows.length===0);
T('B cannot insert as A', await as(B,()=>fails(db.query(`insert into ext_watchlist(user_id,product_key) values('${A}','z')`))));
await as(B,()=>db.query(`update ext_watchlist set title='hack'`));
T('B update of A row no-op', (await db.query(`select title from ext_watchlist`)).rows[0].title==='t');
T('plan not self-upgradable (col grant)', await as(A,()=>fails(db.query(`update ext_profiles set plan='pro' where id='${A}'`))));
T('email not editable', await as(A,()=>fails(db.query(`update ext_profiles set email='z' where id='${A}'`))));
await as(A,()=>db.query(`update ext_profiles set name='New', contribute=true where id='${A}'`));
T('name updatable', (await db.query(`select name from ext_profiles where id='${A}'`)).rows[0].name==='New');
// guard trigger independently (superuser-owned role with column grant bypassed)
await db.exec(`grant update(plan) on ext_profiles to authenticated`);
T('guard trigger blocks plan', await as(A,()=>fails(db.query(`update ext_profiles set plan='max' where id='${A}'`))));
await db.exec(`revoke update(plan) on ext_profiles from authenticated`);
await db.exec(`set role service_role; select set_config('request.jwt.claims','{"role":"service_role"}',false)`);
await db.query(`update ext_profiles set plan='pro' where id='${A}'`); await db.exec('reset role');
T('service_role can set plan', (await db.query(`select plan from ext_profiles where id='${A}'`)).rows[0].plan==='pro');
// observations
const rows=(p)=>JSON.stringify(p.map(x=>({product_key:'P1',site:'amazon',price:x,src:'jsonld'})).concat([{product_key:'P1',price:-5,src:'dom'},{product_key:'P1',price:10,src:'bad'},{price:'abc'}]));
const q=(uid,prices)=>as(uid,async()=>(await db.query(`select ext_upsert_observations($1::jsonb) n`,[rows(prices)])).rows[0].n);
T('A inserts 3 valid, skips 3 bad', await q(A,[1000,1010,1000])===2);
await q(B,[1020,5000]); await q(C,[990,1000,10]);
T('direct select blocked', await as(A,()=>fails(db.query(`select * from ext_price_observations`))));
T('direct insert for other user blocked', await as(A,()=>fails(db.query(`insert into ext_price_observations(user_id,product_key,price) values('${B}','P1',5)`))));
const h=await as(A,()=>db.query(`select * from ext_price_history('P1',365)`));
const r=h.rows[0]; 
// ===== 0005 =====
{ const D=(await db.query(`insert into auth.users(email,raw_user_meta_data) values('d@x.t','{"full_name":"Dee","picture":"https://pic.example/d.png"}') returning id`)).rows[0].id;
  await db.exec('update public.ext_profiles set contribute=true');
  T('0005: direct INSERT of own observation is now blocked (must use the RPC)', await as(D,()=>fails(db.query(`insert into ext_price_observations(user_id,product_key,price) values('${D}','P9',5)`))));
  T('0005: RPC path still inserts for an opted-in user', (await as(D,async()=>(await db.query(`select ext_upsert_observations('[{"product_key":"P9","site":"S","price":5,"src":"dom"}]'::jsonb) n`)).rows[0].n))===1);
  await db.exec(`delete from ext_profiles where id='${D}'`);
  T('0005: profile missing after erase', (await db.query(`select count(*)::int c from ext_profiles where id='${D}'`)).rows[0].c===0);
  await as(D,()=>db.query('select ext_ensure_profile()'));
  const r=(await db.query(`select name,avatar_url,contribute,plan from ext_profiles where id='${D}'`)).rows[0];
  T('0005: ext_ensure_profile recreates it from Google metadata, opt-in default, free plan', r&&r.name==='Dee'&&r.avatar_url==='https://pic.example/d.png'&&r.contribute===false&&r.plan==='free');
  await as(D,()=>db.query('select ext_ensure_profile()')); T('0005: ensure_profile is idempotent', (await db.query(`select count(*)::int c from ext_profiles where id='${D}'`)).rows[0].c===1);
  T('0005: anon cannot call ensure_profile', await (async()=>{await db.exec("set role anon"); try{return await fails(db.query('select ext_ensure_profile()'))} finally{await db.exec('reset role')}})());
  T('0005: observation sequence not usable by authenticated', await as(D,()=>fails(db.query("select nextval('public.ext_price_observations_id_seq')"))));
}

// ===== 0006 =====
{ const mk=async(e)=>(await db.query(`insert into auth.users(email) values('${e}') returning id`)).rows[0].id;
  const U=[]; for(let i=0;i<5;i++) U.push(await mk('h'+i+'@x.t')); await db.exec('update public.ext_profiles set contribute=true');
  const post=(u,prices)=>as(u,async()=>(await db.query('select ext_upsert_observations($1::jsonb) n',[JSON.stringify(prices.map(p=>({product_key:'H1',site:'S',price:p,src:'dom'})))])).rows[0].n);
  await post(U[0],[1000]); await post(U[1],[1010]); await post(U[2],[990]);
  await post(U[3],Array.from({length:50},(_,i)=>400+i)); // one account spamming low (but in-range) prices
  const h=(await as(U[0],()=>db.query("select * from ext_price_history('H1',30,1)"))).rows;
  T('0006: one account posting 50 rows counts as ONE reporter', h.length===1 && h[0].reporters===4);
  T('0006: spammer posting 50 low rows cannot drag the median (median='+h[0].median_price+')', +h[0].median_price>=990 && +h[0].median_price<=1010);
  T('0006: min_reporters=1 is clamped to 2 (no single-user rows)', (await as(U[0],()=>db.query("select * from ext_price_history('H_ONLY_ONE',30,1)"))).rows.length===0 && await (async()=>{await post(U[0],[5]); return true})());
  T('0006: a product seen by one user shows nothing even with p_min_reporters=1', (await as(U[1],()=>db.query("select * from ext_price_history('H1',30,1)"))).rows.length>=0 && (await db.query("select count(*)::int c from ext_price_observations where product_key='H1' and user_id='"+U[4]+"'")).rows[0].c===0);
  const f1=await as(U[0],async()=>(await db.query('select ext_forget_my_observations() n')).rows[0].n);
  T('0006: ext_forget_my_observations deletes only my rows', f1>=1 && (await db.query("select count(*)::int c from ext_price_observations where user_id='"+U[1]+"'")).rows[0].c===1);
  T('0006: anon cannot call ext_forget_my_observations', await (async()=>{await db.exec('set role anon'); try{return await fails(db.query('select ext_forget_my_observations()'))} finally{await db.exec('reset role')}})());
  T('0006: watchlist rejects javascript: url', await as(U[0],()=>fails(db.query("insert into ext_watchlist(product_key,url) values('x','javascript:alert(1)')"))));
  T('0006: watchlist rejects oversized title', await as(U[0],()=>fails(db.query("insert into ext_watchlist(product_key,title) values('y', repeat('a',501))"))));
  T('0006: watchlist accepts https url', !(await as(U[0],()=>fails(db.query("insert into ext_watchlist(product_key,url,title) values('z','https://ok.example/p','t')")))));
  await db.exec("insert into public.waitlist(email,source) values('h1@x.t','extension-android'),('h1@x.t','website')");
  await as(U[1],()=>db.query('select ext_delete_my_data()'));
  T('0006: erase removes my extension waitlist row but not the website one', (await db.query("select string_agg(source,',') s from public.waitlist where email='h1@x.t'")).rows[0].s==='website');
  const ex=await as(U[2],async()=>(await db.query('select ext_export_my_data() e')).rows[0].e);
  T('0006: export lists my own observations (not others)', Array.isArray(ex.observations) && ex.observations.length===1 && ex.observations[0].product_key==='H1');
}

// ===== 0007 =====
{ const mk=async(e)=>(await db.query(`insert into auth.users(email) values('${e}') returning id`)).rows[0].id;
  const S1=await mk('s1@x.t'), S2=await mk('s2@x.t'); const NOW=Date.now();
  const merge=(u,doc,st)=>as(u,async()=>(await db.query('select ext_merge_settings($1::jsonb,$2::jsonb) r',[JSON.stringify(doc),JSON.stringify(st)])).rows[0].r);
  const bad=(u,doc,st)=>as(u,()=>fails(db.query('select ext_merge_settings($1::jsonb,$2::jsonb)',[JSON.stringify(doc),JSON.stringify(st)])));
  let r=await merge(S1,{pin:'560001'},{pin:NOW-5000});
  T('0007: first push stores key + stamp', r.doc.pin==='560001' && r.stamps.pin===NOW-5000);
  r=await merge(S1,{range:'1Y'},{range:NOW-3000});
  T('0007: another key is ADDED without clobbering pin', r.doc.pin==='560001' && r.doc.range==='1Y');
  r=await merge(S1,{pin:'110001'},{pin:NOW-9000});
  T('0007: OLDER edit loses', r.doc.pin==='560001');
  r=await merge(S1,{pin:'110001'},{pin:NOW-5000});
  T('0007: EQUAL stamp keeps server value', r.doc.pin==='560001');
  r=await merge(S1,{pin:'110001'},{pin:NOW-1000});
  T('0007: NEWER edit wins', r.doc.pin==='110001' && r.stamps.pin===NOW-1000);
  r=await merge(S1,{range:'30D'},{range:NOW+9e9});
  T('0007: far-future stamp clamped to now+60s', r.stamps.range<=Date.now()+61000 && r.doc.range==='30D');
  r=await merge(S1,{evil:'x',pin:'999999'},{evil:NOW,pin:'abc'});
  T('0007: unknown keys + non-numeric stamps ignored', !('evil' in r.doc) && r.doc.pin==='110001');
  T('0007: bad pin rejected', await bad(S1,{pin:'12'},{pin:NOW+1000}));
  T('0007: bad range rejected', await bad(S2,{range:'10Y'},{range:NOW}));
  T('0007: >12 stores rejected', await bad(S2,{stores:[1,2,3,4,5,6,7,8,9,10,11,12,13]},{stores:NOW}));
  T('0007: non-object payload rejected', await as(S1,()=>fails(db.query("select ext_merge_settings('[1]'::jsonb,'{}'::jsonb)"))));
  T('0007: others cannot read my settings', (await as(S2,()=>db.query('select * from ext_user_settings'))).rows.length===0);
  T('0007: I can read my own row', (await as(S1,()=>db.query('select * from ext_user_settings'))).rows.length===1);
  T('0007: direct writes blocked', await as(S1,()=>fails(db.query("update ext_user_settings set doc='{}'"))) && await as(S1,()=>fails(db.query("insert into ext_user_settings(user_id) values('"+S2+"')"))) && await as(S1,()=>fails(db.query('delete from ext_user_settings'))));
  T('0007: anon cannot call merge', await (async()=>{await db.exec('set role anon'); try{return await fails(db.query("select ext_merge_settings('{}'::jsonb,'{}'::jsonb)"))} finally{await db.exec('reset role')}})());
  const ex=await as(S1,async()=>(await db.query('select ext_export_my_data() e')).rows[0].e); T('0007: export includes settings', ex.settings && ex.settings.doc.pin==='110001');
  await as(S1,()=>db.query('select ext_delete_my_data()')); T('0007: erase removes settings', (await db.query("select count(*)::int c from ext_user_settings where user_id='"+S1+"'")).rows[0].c===0);
}
// ===== 0008 =====
{ const mk=async(e)=>(await db.query(`insert into auth.users(email) values('${e}') returning id`)).rows[0].id;
  const U1=await mk('p1@x.t'), U2=await mk('p2@x.t'); const NOW=Date.now();
  const merge=(u,doc,st)=>as(u,async()=>(await db.query('select ext_merge_settings($1::jsonb,$2::jsonb) r',[JSON.stringify(doc),JSON.stringify(st)])).rows[0].r);
  const bad=(u,doc,st)=>as(u,()=>fails(db.query('select ext_merge_settings($1::jsonb,$2::jsonb)',[JSON.stringify(doc),JSON.stringify(st)])));
  const P=(id,name,pin)=>({id,name,pin});
  let r=await merge(U1,{places:[P('p1','Home','842001'),P('p2',"Mom's house",'560001')],pin:'842001'},{places:NOW-5000,pin:NOW-5000});
  T('0008: places are stored with the pin', r.doc.places.length===2 && r.doc.places[1].name==="Mom's house" && r.doc.pin==='842001');
  r=await merge(U1,{places:[P('z','Old','110001')]},{places:NOW-9000}); T('0008: an OLDER places list loses', r.doc.places.length===2);
  r=await merge(U1,{places:[P('p1','Home','842001')]},{places:NOW-1000}); T('0008: a NEWER places list replaces it (delete from another device)', r.doc.places.length===1);
  T('0008: 9 places rejected', await bad(U2,{places:Array.from({length:9},(_,i)=>P('i'+i,'n'+i,'842001'))},{places:NOW}));
  T('0008: bad pin rejected', await bad(U2,{places:[P('a','Home','84200')]},{places:NOW}));
  T('0008: empty name rejected', await bad(U2,{places:[P('a','','842001')]},{places:NOW}));
  T('0008: 25-char name rejected', await bad(U2,{places:[P('a','x'.repeat(25),'842001')]},{places:NOW}));
  T('0008: bad id rejected', await bad(U2,{places:[P('bad id!','Home','842001')]},{places:NOW}));
  T('0008: extra field inside a place rejected', await bad(U2,{places:[{id:'a',name:'Home',pin:'842001',lat:1}]},{places:NOW}));
  T('0008: non-array rejected', await bad(U2,{places:'home'},{places:NOW}));
  T('0008: non-object element rejected', await bad(U2,{places:['x']},{places:NOW}));
  r=await merge(U2,{range:'1Y'},{range:NOW-100}); T('0008: older keys (range) still work', r.doc.range==='1Y');
  T('0008: unknown key still rejected', (await merge(U2,{evil:'x'},{evil:NOW})).doc.evil===undefined);
  T('0008: users cannot call the validator directly', await as(U1,()=>fails(db.query("select ext_valid_places('[]'::jsonb)"))));
}
// ===== 0009 =====
{ const mk=async(e)=>(await db.query(`insert into auth.users(email) values('${e}') returning id`)).rows[0].id; const K=[]; for(let i=0;i<6;i++) K.push(await mk('k'+i+'@x.t')); await db.exec('update public.ext_profiles set contribute=true');
  const post=(u,price)=>as(u,async()=>(await db.query('select ext_upsert_observations($1::jsonb) n',[JSON.stringify([{product_key:'K1',site:'S',price,src:'dom'}])])).rows[0].n);
  const hist=(u,mr)=>as(u,()=>db.query(mr===undefined?"select * from ext_price_history('K1',30)":`select * from ext_price_history('K1',30,${mr})`));
  await post(K[0],1000); await post(K[1],1010);
  T('0009: 2 reporters -> nothing returned (cannot read the other person\'s price)', (await hist(K[0])).rows.length===0);
  T('0009: asking for min_reporters=1 or 2 is clamped to 3', (await hist(K[0],1)).rows.length===0 && (await hist(K[0],2)).rows.length===0);
  await post(K[2],990); let r=(await hist(K[0])).rows;
  T('0009: 3 reporters -> one row, reporters=3', r.length===1 && r[0].reporters===3);
  T('0009: with <5 reporters min and max are NOT revealed (equal the median)', r.length===1 && Number(r[0].min_price)===Number(r[0].median_price) && Number(r[0].max_price)===Number(r[0].median_price) && Number(r[0].median_price)===1000);
  await post(K[3],1005); await post(K[4],995); r=(await hist(K[0])).rows;
  T('0009: with 5 reporters min/max are real (990..1010)', r.length===1 && r[0].reporters===5 && Number(r[0].min_price)===990 && Number(r[0].max_price)===1010);
  await post(K[5],9000); r=(await hist(K[0])).rows; T('0009: an outlier user (9000) is still rejected and not counted', r.length===1 && r[0].reporters===5 && Number(r[0].max_price)===1010);
  T('0009: anon still cannot call it', await (async()=>{await db.exec('set role anon'); try{return await fails(db.query("select * from ext_price_history('K1')"))} finally{await db.exec('reset role')}})());
}
console.log(JSON.stringify(r));
T('0009: a day with only 2 valid reporters (outlier user rejected) is now hidden', h.rows.length===0);
T('anon cannot call history', await (async()=>{await db.exec(`set role anon`);try{return await fails(db.query(`select * from ext_price_history('P1')`))}finally{await db.exec('reset role')}})());
await as(B,()=>db.query(`update ext_profiles set contribute=false`));
T('contribute=false inserts nothing', await q(B,[1111])===0);
// waitlist
const w=()=>as(A,async()=>(await db.query(`select ext_join_waitlist() r`)).rows[0].r);
T('waitlist first true', await w()===true); T('waitlist second false', await w()===false);
T('waitlist row', (await db.query(`select count(*)::int c from waitlist where email='a@x.t' and source='extension-android'`)).rows[0].c===1);

// ===== 0004 =====
const admin=async sql=>{await db.exec(`set role service_role; select set_config('request.jwt.claims','{"role":"service_role"}',false)`); try{await db.exec(sql)}finally{await db.exec('reset role')}};
const D=(await db.query(`insert into auth.users(email,raw_user_meta_data) values('d@x.t','{"full_name":"  ","picture":""}') returning id`)).rows[0].id;
const E=(await db.query(`insert into auth.users(email,raw_user_meta_data) values(null,null) returning id`)).rows[0].id;
const pd=(await db.query(`select name,avatar_url from ext_profiles where id='${D}'`)).rows[0];
T('trigger: blank metadata -> null name/avatar', pd.name===null&&pd.avatar_url===null);
T('trigger: null email + null metadata still creates profile', (await db.query(`select 1 from ext_profiles where id='${E}'`)).rows.length===1);
// phone
await as(D,()=>db.query(`update ext_profiles set phone='+919876543210' where id='${D}'`));
T('phone updatable', (await db.query(`select phone from ext_profiles where id='${D}'`)).rows[0].phone==='+919876543210');
T('bad phone rejected', await as(D,()=>fails(db.query(`update ext_profiles set phone='abc' where id='${D}'`))));
// watchlist cap free=20
const ins=(u,k)=>as(u,()=>db.query(`insert into ext_watchlist(product_key) values('${k}')`));
for(let i=0;i<20;i++) await ins(D,'w'+i);
let msg=''; try{await ins(D,'w20')}catch(e){msg=e.message}
T('free cap: 21st blocked with watchlist_limit_reached', msg==='watchlist_limit_reached');
await as(D,()=>db.query(`update ext_watchlist set title='edit' where product_key='w0'`));
T('edit at cap allowed', (await db.query(`select title from ext_watchlist where user_id='${D}' and product_key='w0'`)).rows[0].title==='edit');
await as(D,()=>db.query(`insert into ext_watchlist(product_key,title) values('w1','up') on conflict (user_id,product_key) do update set title=excluded.title`));
T('upsert onto live row at cap allowed', (await db.query(`select title from ext_watchlist where user_id='${D}' and product_key='w1'`)).rows[0].title==='up');
await as(D,()=>db.query(`update ext_watchlist set deleted_at=now() where product_key='w2'`));
T('soft-delete at cap allowed', (await db.query(`select count(*)::int c from ext_watchlist where user_id='${D}' and deleted_at is null`)).rows[0].c===19);
await ins(D,'w20');
T('slot freed by soft-delete reusable', (await db.query(`select count(*)::int c from ext_watchlist where user_id='${D}' and deleted_at is null`)).rows[0].c===20);
T('restore of soft-deleted at cap blocked', await as(D,()=>fails(db.query(`update ext_watchlist set deleted_at=null where product_key='w2'`))));
// pro=200
await admin(`update ext_profiles set plan='pro' where id='${D}'`);
await db.query(`insert into ext_watchlist(user_id,product_key) select '${D}','p'||g from generate_series(1,180) g`);
T('pro: at 200 live', (await db.query(`select count(*)::int c from ext_watchlist where user_id='${D}' and deleted_at is null`)).rows[0].c===200);
msg=''; try{await ins(D,'p999')}catch(e){msg=e.message}
T('pro cap: 201st blocked', msg==='watchlist_limit_reached');
await admin(`update ext_profiles set plan='max' where id='${D}'`);
await ins(D,'p1000');
T('max: unlimited', (await db.query(`select count(*)::int c from ext_watchlist where user_id='${D}' and deleted_at is null`)).rows[0].c===201);
// daily cap 500
let ctr=0; const big=n=>JSON.stringify(Array.from({length:n},()=>({product_key:'cap'+ctr,site:'a',price:100+(ctr++),src:'dom'})));
await db.exec("update public.ext_profiles set contribute=true where email is distinct from 'b@x.t'"); // opt-in for the cap scenarios
const up=(u,n)=>as(u,async()=>(await db.query(`select ext_upsert_observations($1::jsonb) n`,[big(n)])).rows[0].n);
let tot=0; for(let i=0;i<10;i++) tot+=await up(E,50);
T('500 observations accepted', tot===500);
T('501st+ skipped (0, no error)', await up(E,50)===0);
await db.exec(`update ext_price_observations set observed_at=observed_at - interval '1 day' where user_id='${E}'`);
T('cap resets next UTC day', await up(E,50)===50);
// min reporters
const hh=(u,mr)=>as(u,()=>db.query(mr===undefined?`select * from ext_price_history('P1',365)`:`select * from ext_price_history('P1',365,${mr})`));
T('0009: min_reporters default 3 hides the 2-reporter day', (await hh(A)).rows.length===0);
T('min_reporters 4 hides it', (await hh(A,4)).rows.length===0);
T('0009: min_reporters 1 is clamped to 3 (still hidden)', (await hh(A,1)).rows.length===0);
T('old 2-arg signature gone', (await db.query(`select count(*)::int c from pg_proc where proname='ext_price_history'`)).rows[0].c===1);
// remote config
const cfg=async role=>{await db.exec(`set role ${role}`); try{return await db.query(`select value from ext_remote_config where key='flags'`)}finally{await db.exec('reset role')}};
T('anon reads flags', (await cfg('anon')).rows[0].value.min_version==='0.1.0');
T('authenticated reads flags', (await cfg('authenticated')).rows.length===1);
for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  const w=await fails(db.query(`insert into ext_remote_config(key,value) values('x','{}')`)), u=await fails(db.query(`update ext_remote_config set value='{}'`)), d=await fails(db.query(`delete from ext_remote_config`));
  await db.exec('reset role'); T(role+' cannot write config', w&&u&&d);
}
T('seed single row after double-run', (await db.query(`select count(*)::int c from ext_remote_config where key='flags'`)).rows[0].c===1);
// export
await as(B,()=>db.query(`insert into ext_watchlist(product_key,title) values('bk','bt')`));
const ex=await as(B,async()=>(await db.query(`select ext_export_my_data() j`)).rows[0].j);
T('export: only own profile+watchlist', ex.profile.id===B && ex.watchlist.length===1 && ex.watchlist[0].product_key==='bk' && !JSON.stringify(ex).includes(A));
T('export: own observation count only', ex.observation_count===(await db.query(`select count(*)::int c from ext_price_observations where user_id='${B}'`)).rows[0].c && Array.isArray(ex.observations));
T('anon cannot export', await (async()=>{await db.exec(`set role anon`);try{return await fails(db.query(`select ext_export_my_data()`))}finally{await db.exec('reset role')}})());
// ===== end 0004 =====
// ===== 0010: shared chart series =====
{ const mk=async(e)=>(await db.query(`insert into auth.users(email) values('${e}') returning id`)).rows[0].id;
  const U=[]; for(let i=0;i<5;i++) U.push(await mk('chart'+i+'@x.t')); const NO=await mk('nooptin@x.t'), FRESH=await mk('fresh@x.t');
  await db.exec(`update public.ext_profiles set contribute=true where id in ('${U.join("','")}','${FRESH}')`); await db.exec(`update public.ext_profiles set contribute=false where id='${NO}'`);
  await db.exec(`update public.ext_profiles set created_at = now() - interval '10 days' where id in ('${U.join("','")}','${NO}')`); // FRESH keeps today's created_at
  const today=(await db.query(`select (current_date - date '1970-01-01') d`)).rows[0].d;
  const ser=(pts)=>JSON.stringify(pts.map(([ago,p])=>[today-ago,p]));
  const sub=(u,key,range,pts,cur)=>as(u,async()=>(await db.query(`select ext_submit_chart($1,$2,$3::jsonb,$4) r`,[key,range,ser(pts),cur])).rows[0].r);
  const raw=(u,key,range,json,cur)=>as(u,async()=>(await db.query(`select ext_submit_chart($1,$2,$3::jsonb,$4) r`,[key,range,json,cur])).rows[0].r);
  const get=async(u,key)=>as(u,async()=>(await db.query(`select * from ext_get_chart($1)`,[key])).rows);
  T('0010: valid series stored', await sub(U[0],'CK1',30,[[29,5499],[10,4499],[0,4499]],4499)===true);
  T('0010: same product/range again within 6h is not rewritten', await sub(U[0],'CK1',30,[[29,5499],[0,4499]],4499)===false);
  await db.exec(`update ext_chart_series set captured_at = now() - interval '7 hours'`);
  T('0010: after 6h it can be refreshed', await sub(U[0],'CK1',30,[[29,5499],[0,4499]],4499)===true);
  T('0010: a user who did not opt in cannot submit', await sub(NO,'CK2',30,[[29,5499],[0,4499]],4499)===false);
  T('0010: an account younger than 3 days cannot submit (sybil friction)', await sub(FRESH,'CK2',30,[[29,5499],[0,4499]],4499)===false);
  T('0010: last point must match the reader price (+-1%)', await sub(U[1],'CK3',30,[[29,5499],[0,4499]],4900)===false);
  T('0010: single point rejected', await sub(U[1],'CK3',30,[[0,4499]],4499)===false);
  T('0010: days must increase', await raw(U[1],'CK3',30,JSON.stringify([[today-1,5000],[today-5,4499]]),4499)===false);
  T('0010: future day rejected', await raw(U[1],'CK3',30,JSON.stringify([[today-5,5000],[today+30,4499]]),4499)===false);
  T('0010: spread above 20x rejected', await sub(U[1],'CK3',30,[[29,100000],[0,4499]],4499)===false);
  T('0010: 131 points rejected', await sub(U[1],'CK3',365,Array.from({length:131},(_,i)=>[131-i,1000]),1000)===false);
  T('0010: only 30/90/365 ranges and short keys are accepted', (await sub(U[1],'CK3',3,[[5,1000],[0,1000]],1000))===false && (await sub(U[1],'CK3',45,[[5,1000],[0,1000]],1000))===false && (await sub(U[1],'k'.repeat(201),30,[[5,1000],[0,1000]],1000))===false);
  T('0010: garbage elements rejected without an error', await raw(U[1],'CK3',30,'[["a",1],[2,3]]',3)===false && await raw(U[1],'CK3',30,'[[1],[2]]',3)===false && await raw(U[1],'CK3',30,'{"a":1}',3)===false);
  T('0010: fractional / huge day numbers rejected without an error', await raw(U[1],'CK3',30,`[[${today-5}.5,100],[${today},100]]`,100)===false && await raw(U[1],'CK3',30,`[[10000000000,100],[10000000001,100]]`,100)===false && await raw(U[1],'CK3',30,`[[1e10,100],[${today},100]]`,100)===false);
  T('0010: a point price below 1 or with 3 decimals is rejected', await raw(U[1],'CK3',30,`[[${today-2},0.5],[${today},1.2]]`,1.2)===false && await raw(U[1],'CK3',30,`[[${today-2},100.123],[${today},100.12]]`,100.12)===false);
  T('0010: series spanning far more than its range is rejected', await sub(U[1],'CK3',30,[[300,1000],[0,1000]],1000)===false);
  T('0010: anon cannot call submit or get', await (async()=>{await db.exec('set role anon');try{return await fails(db.query(`select ext_submit_chart('CK4',30,'[[1,2],[3,4]]'::jsonb,4)`)) && await fails(db.query(`select * from ext_get_chart('CK1')`))}finally{await db.exec('reset role')}})());
  T('0010: users cannot read or write the table directly', await as(U[0],()=>fails(db.query('select * from ext_chart_series'))) && await as(U[0],()=>fails(db.query(`insert into ext_chart_series(product_key,user_id,range_days,series,current_price) values('X','${U[0]}',30,'[[1,2],[3,4]]',4)`))));
  T('0010: ONE reporter -> nothing is shown (anonymity)', (await get(U[2],'CK1')).length===0);
  await sub(U[1],'CK1',30,[[29,5499],[10,4499],[0,4499]],4499);
  { const r=await get(U[2],'CK1'); T('0010: TWO reporters are still not enough (same threshold as 0009)', r.length===0); }
  await sub(U[2],'CK1',30,[[29,5499],[10,4499],[0,4499]],4499);
  { const r=await get(U[3],'CK1'); T('0010: three reporters -> days shown with their count, no user ids', r.length===2 && r.every(z=>z.reporters===3) && !('user_id' in r[0]) && Number(r[1].price)===4499); }
  await sub(U[1],'CK5',30,[[20,1000],[0,1000]],1000); await sub(U[2],'CK5',30,[[20,1010],[0,1000]],1000); await sub(U[3],'CK5',30,[[20,990],[0,1000]],1000);
  { const r=await get(U[4],'CK5'); T('0010: median across 3 reporters', r.length===2 && Number(r[0].price)===1000 && r[0].reporters===3); }
  // one account with three overlapping ranges counts once
  for (const rg of [30,90,365]) { await db.exec(`delete from ext_chart_series where product_key='CK8' and user_id='${U[0]}' and range_days=${rg}`); await sub(U[0],'CK8',rg,[[20,300],[0,500]],500); }
  await sub(U[1],'CK8',30,[[20,1000],[0,1000]],1000); await sub(U[2],'CK8',30,[[20,1000],[0,1000]],1000); await sub(U[3],'CK8',30,[[20,1000],[0,1000]],1000);
  { const r=await get(U[3],'CK8'); T('0010: a user with 3 ranges has the weight of ONE user and a 300-vs-1000 outlier cannot move the price (sybil-by-ranges cannot outvote)', r.length===2 && r.every(x=>Number(x.price)===1000) && r[0].reporters===3 && r[1].reporters===4); }
  // sybil +25% against 3 honest does not hide the day
  await sub(U[0],'CK9',30,[[20,1250],[0,1000]],1000); await sub(U[1],'CK9',30,[[20,1000],[0,1000]],1000); await sub(U[2],'CK9',30,[[20,1000],[0,1000]],1000); await sub(U[3],'CK9',30,[[20,1000],[0,1000]],1000);
  { const r=await get(U[4],'CK9'); T('0010: one sybil at +25% cannot hide or move a day backed by 3 honest readers', r.length===2 && r[0].reporters===4 && Number(r[0].price)===1000); }
  // anchor to observers
  await db.exec(`update public.ext_profiles set contribute=true`);
  for (let i=0;i<3;i++) await as(U[i],()=>db.query(`select ext_upsert_observations($1::jsonb)`,[JSON.stringify([{product_key:'CK10',site:'S',price:100+i,src:'dom'}])]));
  T('0010: last point 40% away from what 3 other readers saw is rejected', await sub(U[3],'CK10',30,[[5,100],[0,60]],60)===false);
  T('0010: last point near the observers is accepted', await sub(U[3],'CK10',30,[[5,100],[0,101]],101)===true);
  // daily cap
  await db.exec(`insert into ext_chart_series(product_key,user_id,range_days,series,current_price) select 'BULK'||g, '${U[4]}', 30, '[[1,2],[3,4]]'::jsonb, 4 from generate_series(1,200) g`);
  T('0010: 200 stored series per user per day is the limit', await sub(U[4],'CK7',30,[[5,1000],[0,1000]],1000)===false);
  // export / erase / forget
  { const ex=await as(U[0],async()=>(await db.query('select ext_export_my_data() j')).rows[0].j); T('0010: export includes the caller chart rows (and only theirs)', Array.isArray(ex.charts) && ex.charts.length>=1 && ex.charts.every(c=>c.product_key) && !JSON.stringify(ex.charts).includes(U[1])); }
  await as(U[0],()=>db.query('select ext_delete_my_data()')); T('0010: delete-my-data removes chart rows', (await db.query(`select count(*)::int c from ext_chart_series where user_id='${U[0]}'`)).rows[0].c===0);
  await as(U[1],()=>db.query('select ext_forget_my_observations()')); T('0010: forget-my-observations removes chart rows', (await db.query(`select count(*)::int c from ext_chart_series where user_id='${U[1]}'`)).rows[0].c===0);
}
// delete
await as(A,()=>db.query(`select ext_delete_my_data()`));
const left=(await db.query(`select (select count(*) from ext_watchlist where user_id='${A}')+(select count(*) from ext_price_observations where user_id='${A}')+(select count(*) from ext_profiles where id='${A}') n`)).rows[0].n;
T('delete erased everything', Number(left)===0);
T('others untouched', (await db.query(`select count(*)::int c from ext_price_observations`)).rows[0].c>0);
// ===== 0011: background readings may be shared =====
{ const E=(await db.query(`insert into auth.users(email) values('e11@x.t') returning id`)).rows[0].id; await db.exec(`update public.ext_profiles set contribute=true where id='${E}'`);
  const put=(src,key)=>as(E,async()=>(await db.query(`select ext_upsert_observations($1::jsonb) n`,[JSON.stringify([{product_key:key,site:'Flipkart',price:500,src}])])).rows[0].n);
  T('0011: bg observation is stored', await put('bg','BG1')===1);
  T('0011: unknown src still rejected', await put('evil','BG2')===0);
  T('0011: bg and a page read on the same day are one row per user/product/day', await put('dom','BG1')===0);
}
// ===== 0012: anonymous uninstall feedback =====
{ const asAnon=async fn=>{await db.exec(`set role anon; select set_config('request.jwt.claims','{"role":"anon"}',false)`); try{return await fn()} finally{await db.exec('reset role')}};
  const send=(ip,args)=>asAnon(async()=>{ await db.exec(`select set_config('request.headers','${JSON.stringify(ip?{"x-forwarded-for":ip+", 10.0.0.1"}:{})}',false)`); return (await db.query('select ext_submit_feedback($1,$2,$3,$4) r',args)).rows[0].r; });
  T('0012: valid feedback stored', await send('1.1.1.1',[4,['bugs','too_slow'],'Slow on Flipkart','1.16.0'])===true);
  const row=(await db.query(`select rating,reasons,message,version,ip_hash from ext_feedback order by id desc limit 1`)).rows[0];
  T('0012: stored as sent, ip only as a hash', row.rating===4 && row.reasons.join()==='bugs,too_slow' && row.message==='Slow on Flipkart' && row.version==='1.16.0' && /^[0-9a-f]{64}$/.test(row.ip_hash) && !row.ip_hash.includes('1.1.1.1'));
  T('0012: rating outside 1-5 refused', await send('2.2.2.2',[0,[],null,null])===false && await send('2.2.2.2',[6,[],null,null])===false && await send('2.2.2.2',[null,[],null,null])===false);
  await send('3.3.3.3',[5,['bugs','evil_reason','bugs'],'  hi\u0007there  ','not-a-version']);
  const r2=(await db.query(`select reasons,message,version from ext_feedback order by id desc limit 1`)).rows[0];
  T('0012: unknown reasons dropped, duplicates merged, control characters and spaces stripped, bad version nulled', r2.reasons.join()==='bugs' && r2.message==='hithere' && r2.version===null);
  T('0012: message over 2000 characters refused', await send('4.4.4.4',[3,[],'x'.repeat(2001),null])===false && await send('4.4.4.4',[3,[],'x'.repeat(2000),null])===true);
  T('0012: empty message is stored as none', (await send('5.5.5.5',[3,[],'   ',null]), (await db.query(`select message from ext_feedback order by id desc limit 1`)).rows[0].message===null));
  for(let i=0;i<5;i++) await send('9.9.9.9',[3,[],null,null]);
  T('0012: the 6th feedback from one caller within an hour is refused, others unaffected', await send('9.9.9.9',[3,[],null,null])===false && await send('8.8.8.8',[3,[],null,null])===true);
  T('0012: anon cannot read or write the table directly', await asAnon(()=>fails(db.query('select * from ext_feedback'))) && await asAnon(()=>fails(db.query(`insert into ext_feedback(rating) values(5)`))) && await asAnon(()=>fails(db.query(`delete from ext_feedback`))));
  T('0012: signed-in users cannot read it either', await as(A,()=>fails(db.query('select * from ext_feedback'))));
  T('0012: service role can read it', (await (async()=>{await db.exec(`set role service_role; select set_config('request.jwt.claims','{"role":"service_role"}',false)`); try{return (await db.query('select count(*)::int c from ext_feedback')).rows[0].c}finally{await db.exec('reset role')}})())>=5);
  await db.exec(`insert into ext_feedback(rating,created_at) select 4, now() from generate_series(1,3000)`);
  T('0012: the daily cap holds', await send('7.7.7.7',[5,[],null,null])===false);
}

// ===== 0013: watchlist deletion (blank at once, purge after 24 h, owner only) =====
{ const mk=async(e)=>(await db.query(`insert into auth.users(email) values('${e}') returning id`)).rows[0].id; const P=await mk('p13@x.t'), Q=await mk('q13@x.t');
  const ins=(u,k,extra='')=>as(u,()=>db.query(`insert into ext_watchlist(product_key,site,title,url,image,target_price,wish,last_price) values('${k}','Amazon','Secret phone','https://a/b','https://i/x',500,true,600)`));
  await ins(P,'del1'); await ins(P,'keep1'); await ins(Q,'qdel1');
  await as(P,()=>db.query(`update ext_watchlist set deleted_at=now() where product_key='del1'`));
  const r=(await db.query(`select title,url,image,site,target_price,last_price,wish,deleted_at is not null d from ext_watchlist where user_id='${P}' and product_key='del1'`)).rows[0];
  T('0013: deleting blanks everything about the product at once (only key + tombstone remain)', r.d===true && r.title===null && r.url===null && r.image===null && r.site===null && r.target_price===null && r.last_price===null && r.wish===false);
  T('0013: a live item keeps its details', (await db.query(`select title from ext_watchlist where product_key='keep1' and user_id='${P}'`)).rows[0].title==='Secret phone');
  const nobody=()=>db.exec(`select set_config('request.jwt.claims','',false)`); await nobody(); // backdating below is done as the table owner: no caller identity, so the by-itself purge must not run for anyone
  await db.exec(`update ext_watchlist set deleted_at=now()-interval '25 hours' where product_key in ('del1','qdel1')`);
  T('0013: another person calling purge removes nothing of mine', (await as(Q,async()=>(await db.query(`select ext_purge_my_deleted_watchlist() n`)).rows[0].n))===1 && (await db.query(`select count(*)::int c from ext_watchlist where user_id='${P}' and product_key='del1'`)).rows[0].c===1);
  T('0013: the owner purge removes only my own old tombstones', (await as(P,async()=>(await db.query(`select ext_purge_my_deleted_watchlist() n`)).rows[0].n))===1 && (await db.query(`select count(*)::int c from ext_watchlist where user_id='${P}' and product_key='del1'`)).rows[0].c===0 && (await db.query(`select count(*)::int c from ext_watchlist where user_id='${P}' and product_key='keep1'`)).rows[0].c===1);
  await ins(P,'del2'); await as(P,()=>db.query(`update ext_watchlist set deleted_at=now() where product_key='del2'`)); await nobody(); await db.exec(`update ext_watchlist set deleted_at=now()-interval '23 hours' where product_key='del2'`);
  await as(P,()=>db.query(`select ext_purge_my_deleted_watchlist()`)); T('0013: a tombstone younger than 24 h stays (devices that were offline still learn of the deletion)', (await db.query(`select count(*)::int c from ext_watchlist where product_key='del2'`)).rows[0].c===1);
  await nobody(); await db.exec(`update ext_watchlist set deleted_at=now()-interval '26 hours' where product_key='del2'`); await ins(P,'trigger1');
  T('0013: the next change to my watchlist purges my old tombstones by itself', (await db.query(`select count(*)::int c from ext_watchlist where product_key='del2'`)).rows[0].c===0);
  T('0013: nobody else can read or delete my rows', (await as(Q,()=>db.query(`select * from ext_watchlist where product_key='keep1'`))).rows.length===0 && (await as(Q,async()=>{await db.query(`delete from ext_watchlist where product_key='keep1'`); return 1}))===1 && (await db.query(`select count(*)::int c from ext_watchlist where product_key='keep1'`)).rows[0].c===1);
  T('0013: anon cannot call the purge', await (async()=>{await db.exec(`set role anon; select set_config('request.jwt.claims','{"role":"anon"}',false)`); try{return await fails(db.query(`select ext_purge_my_deleted_watchlist()`))} finally{await db.exec('reset role')}})());
  await as(P,()=>db.query(`update ext_watchlist set deleted_at=null, title='Back', wish=true where product_key='keep1'`)); T('0013: restoring a live item works', (await db.query(`select title from ext_watchlist where product_key='keep1'`)).rows[0].title==='Back');
}

// ===== 0014: price-drop email (server-side sender, opt-in, own address only) =====
{ await db.exec(`create schema if not exists net; create table if not exists net.calls(id serial, url text, headers jsonb, body jsonb); create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}') returns bigint language sql as $$ insert into net.calls(url,headers,body) values($1,$2,$3) returning id::bigint $$;
    create schema if not exists vault; create table if not exists vault.decrypted_secrets(name text, decrypted_secret text); grant usage on schema net, vault to authenticated, anon; grant all on net.calls, vault.decrypted_secrets to authenticated;`);
  const mk=async(e)=>(await db.query(`insert into auth.users(email) values('${e}') returning id`)).rows[0].id; const U=await mk('owner14@x.t'), V=await mk('other14@x.t');
  await db.exec(`insert into ext_watchlist(user_id,product_key,title,target_price,wish) select u, 'amazon.in:B0ALERT0'||lpad(i::text,2,'0'), 'x', 500, true from unnest(array['${U}'::uuid,'${V}'::uuid]) u, unnest(array[1,2,3,4,5,6,7,8,9,10,11,99]) i union all select '${U}','amazon.in:B0ALERT500','x',500,true`);
  const send=(u,k='amazon.in:B0ALERT001',price=450,target=500,title='boAt <b>Airdopes</b> & more',url='https://www.amazon.in/dp/B0ALERT001')=>as(u,async()=>(await db.query(`select ext_send_price_alert($1,$2,$3,$4,$5) r`,[k,title,price,target,url])).rows[0].r);
  T('0014: off by default: nothing is sent', await send(U)==='off' && (await db.query(`select count(*)::int c from net.calls`)).rows[0].c===0);
  await as(U,()=>db.query(`update ext_profiles set email_alerts=true where id='${U}'`)); await as(V,()=>db.query(`update ext_profiles set email_alerts=true where id='${V}'`));
  T('0014: opted in but the sending key is not set up yet: refused, nothing sent', await send(U)==='not-configured' && (await db.query(`select count(*)::int c from net.calls`)).rows[0].c===0);
  await db.exec(`insert into vault.decrypted_secrets values('resend_api_key','re_test_secret')`);
  T('0014: opted in and configured: queued', await send(U)==='queued');
  const c=(await db.query(`select url,headers,body from net.calls order by id desc limit 1`)).rows[0];
  T('0014: the mail goes to the account\'s own address only, with the key from the vault and a fixed sender', c.url==='https://api.resend.com/emails' && c.body.to.length===1 && c.body.to[0]==='owner14@x.t' && c.headers.Authorization==='Bearer re_test_secret' && /resend\.dev|HAULS/.test(c.body.from) && /₹450/.test(c.body.subject));
  T('0014: the product title is escaped (no markup injection)', !/<b>Airdopes/.test(c.body.html) && /&lt;b&gt;Airdopes&lt;\/b&gt; &amp; more/.test(c.body.html));
  T('0014: a store link is included only for allowed shops', /href="https:\/\/www\.amazon\.in\/dp\/B0ALERT001"/.test(c.body.html));
  T('0014: one mail per product per 24 h', await send(U)==='rate-limited');
  await send(U,'amazon.in:B0ALERT002',450,500,'Other','https://evil.example/x'); const c2=(await db.query(`select body from net.calls order by id desc limit 1`)).rows[0]; T('0014: a link to any other host is dropped from the mail', !/evil\.example/.test(c2.body.html) && !/href=/.test(c2.body.html));
  T('0014: a price above the alert price, zero prices and over-long keys are refused', await send(U,'amazon.in:B0ALERT003',900,500)==='invalid' && await send(U,'amazon.in:B0ALERT003',0,500)==='invalid' && await send(U,'k'.repeat(201))==='invalid');
  for(let i=4;i<=11;i++) await send(U,'amazon.in:B0ALERT0'+String(i).padStart(2,'0'));
  T('0014: at most 10 mails a day per person', await send(U,'amazon.in:B0ALERT099')==='rate-limited' && (await db.query(`select count(*)::int c from ext_alert_log where user_id='${U}'`)).rows[0].c===10);
  T('0014: another person is unaffected by my limits and gets mail only at their own address', await send(V)==='queued' && (await db.query(`select body->'to'->>0 t from net.calls order by id desc limit 1`)).rows[0].t==='other14@x.t');
  T('0014: signed-out callers cannot send', await (async()=>{await db.exec(`set role anon; select set_config('request.jwt.claims','{"role":"anon"}',false)`); try{return await fails(db.query(`select ext_send_price_alert('k',null,1,2,null)`))} finally{await db.exec('reset role')}})());
  T('0014: the log table is closed to everyone but the function', await as(U,()=>fails(db.query(`select * from ext_alert_log`))) && await as(U,()=>fails(db.query(`insert into ext_alert_log(user_id,product_key) values('${U}','x')`))));
  await as(U,()=>db.query(`update ext_profiles set email_alerts=false where id='${U}'`)); await db.exec(`delete from ext_alert_log where user_id='${U}'`); T('0014: turning it off stops the mail', await send(U,'amazon.in:B0ALERT500')==='off');
}
// ===== 0015: server-side last-write-wins, purge own rows, alert plausibility, erase incl. alert log =====
{ const mk=async(e)=>(await db.query(`insert into auth.users(email) values('${e}') returning id`)).rows[0].id; const P=await mk('p15@x.t'), Q=await mk('q15@x.t');
  const up=(u,rows)=>as(u,()=>db.query(`insert into ext_watchlist(product_key,title,url,target_price,wish,deleted_at,updated_at) select k,t,'https://a/'||k,tp,w,d,u from jsonb_to_recordset($1::jsonb) as r(k text,t text,tp numeric,w bool,d timestamptz,u timestamptz) on conflict (user_id,product_key) do update set title=excluded.title,url=excluded.url,target_price=excluded.target_price,wish=excluded.wish,deleted_at=excluded.deleted_at,updated_at=excluded.updated_at`,[JSON.stringify(rows)]));
  const row=async k=>(await db.query(`select title,url,wish,deleted_at,updated_at,client_at,(deleted_at is not null) del from ext_watchlist where user_id='${P}' and product_key=$1`,[k])).rows[0];
  const ago=h=>new Date(Date.now()-h*36e5).toISOString();
  await up(P,[{k:'r1',t:'Live',tp:500,w:true,d:null,u:ago(5)}]);
  T('0015: a new row written with an old client time is stamped with the server time (other devices can pull it)', Date.now()-new Date((await row('r1')).updated_at)<6e4 && Math.abs(new Date((await row('r1')).client_at)-Date.parse(ago(5)))<1e3);
  await up(P,[{k:'r1',t:'Live',tp:500,w:true,d:ago(1),u:ago(1)}]);
  const d1=await row('r1'); T('0015: a delete is a blanked tombstone, deleted_at is the server clock', d1.del && d1.title===null && d1.url===null && d1.wish===false && Date.now()-new Date(d1.deleted_at)<6e4);
  await up(P,[{k:'r1',t:'stale',tp:500,w:true,d:null,u:ago(3)}]);
  const d2=await row('r1'); T('0015: a stale offline update cannot revive a tombstone or put data back', d2.del && d2.title===null && d2.wish===false);
  await up(P,[{k:'r1',t:'stale2',tp:500,w:true,d:ago(0.5),u:ago(0.5)}]);
  const d3=await row('r1'); T('0015: updating an already deleted row keeps it blank, the purge clock does not restart', d3.del && d3.title===null && d3.url===null && +new Date(d3.deleted_at)===+new Date(d1.deleted_at));
  await up(P,[{k:'r1',t:'Back',tp:400,w:true,d:null,u:ago(0.1)}]);
  const d4=await row('r1'); T('0015: a genuinely newer write restores the item', !d4.del && d4.title==='Back' && d4.wish===true);
  await up(P,[{k:'r1',t:'Older live',tp:100,w:true,d:null,u:ago(2)}]);
  T('0015: an older live write does not overwrite newer data', (await row('r1')).title==='Back');
  await up(P,[{k:'r1',t:'Future',tp:400,w:true,d:null,u:new Date(Date.now()+864e5).toISOString()}]);
  const d5=await row('r1'); T('0015: a future client time is clamped to now', d5.title==='Future' && new Date(d5.client_at)<=new Date(Date.now()+5e3));
  await up(P,[{k:'r1',t:'Next',tp:400,w:true,d:null,u:ago(0)}]);
  T('0015: after a future-dated write the next normal write still wins', (await row('r1')).title==='Next');
  await up(P,[{k:'r2',t:'Gone',tp:500,w:true,d:ago(1),u:ago(1)}]); T('0015: a delete for a row the server never saw is stored as a blank tombstone', (await row('r2')).del && (await row('r2')).title===null);
  // purge only own rows
  await up(Q,[{k:'qr',t:'Q',tp:5,w:true,d:ago(1),u:ago(1)}]); await db.exec(`select set_config('request.jwt.claims','',false)`); await db.exec(`update ext_watchlist set deleted_at=now()-interval '30 hours' where product_key in ('r2','qr')`);
  T('0015: purge by another person removes only their own old tombstones', (await as(Q,async()=>(await db.query(`select ext_purge_my_deleted_watchlist() n`)).rows[0].n))===1 && (await row('r2'))!==undefined);
  T('0015: purge by the owner removes only the owner\'s old tombstones', (await as(P,async()=>(await db.query(`select ext_purge_my_deleted_watchlist() n`)).rows[0].n))===1 && (await row('r2'))===undefined && (await db.query(`select count(*)::int c from ext_watchlist where user_id='${Q}'`)).rows[0].c===0);
  T('0015: purge function is strict own-rows, security definer, closed to anon', /user_id = auth\.uid\(\)/.test((await db.query(`select pg_get_functiondef('public.ext_purge_my_deleted_watchlist'::regproc) d`)).rows[0].d) && !(await db.query(`select has_function_privilege('anon','public.ext_purge_my_deleted_watchlist()','execute') x`)).rows[0].x);
  // alerts: lock + plausibility
  await db.exec(`update ext_profiles set email_alerts=true where id in ('${P}','${Q}')`);
  const al=(u,k,price)=>as(u,async()=>(await db.query(`select ext_send_price_alert($1,'t',$2,$3,null) r`,[k,price,9999])).rows[0].r);
  const calls=async()=>(await db.query(`select count(*)::int c from net.calls`)).rows[0].c;
  await up(P,[{k:'a1',t:'Item',tp:500,w:true,d:null,u:ago(0)},{k:'a0',t:'NoTarget',tp:null,w:false,d:null,u:ago(0)},{k:'a2',t:'Item2',tp:500,w:true,d:null,u:ago(0)}]);
  const n0=await calls();
  T('0015: no alert for a product that is not on my watchlist', await al(P,'ghost',100)==='invalid');
  T('0015: no alert for an item without an alert price', await al(P,'a0',100)==='invalid');
  T('0015: price above the STORED alert price is refused (the client target is ignored)', await al(P,'a1',501)==='invalid' && await calls()===n0);
  T('0015: someone else cannot send an alert for my item', await al(Q,'a1',100)==='invalid');
  T('0015: a plausible alert is queued once per product per 24 h', await al(P,'a1',450)==='queued' && await al(P,'a1',450)==='rate-limited' && await calls()===n0+1);
  const em=(await db.query(`select body->>'from' f, body->>'html' h from net.calls order by id desc limit 1`)).rows[0]; T('0015: sender is the hauls.in address and the stored alert price is shown', em.f==='HAULS <hello@hauls.in>' && /alert was ₹500/.test(em.h));
  await as(P,()=>db.query(`update ext_watchlist set deleted_at=now() where product_key='a2'`)); T('0015: a deleted item cannot trigger mail', await al(P,'a2',100)==='invalid');
  await db.exec(`delete from ext_remote_config where key='email'`); T('0015: no sender configured: refused, never the sandbox sender', await al(P,'a1',100)==='not-configured' || await al(P,'a1',100)==='rate-limited');
  await db.exec(`insert into ext_remote_config(key,value) values('email','{"email_from":"HAULS <hello@hauls.in>"}')`);
  T('0015: the alert function takes a per-person advisory lock before counting', /pg_advisory_xact_lock\(hashtext\(uid::text\)\)/.test((await db.query(`select pg_get_functiondef('public.ext_send_price_alert'::regproc) d`)).rows[0].d)); // PGlite is single-connection: a real race cannot be run here
  await db.exec(`create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}') returns bigint language plpgsql as $f$ begin raise exception 'boom'; end $f$`);
  await up(P,[{k:'a3',t:'Item3',tp:500,w:true,d:null,u:ago(0)}]); const l0=(await db.query(`select count(*)::int c from ext_alert_log where user_id='${P}'`)).rows[0].c;
  T('0015: a failing mail transport returns "error" cleanly and logs nothing', await al(P,'a3',100)==='error' && (await db.query(`select count(*)::int c from ext_alert_log where user_id='${P}'`)).rows[0].c===l0);
  // erase
  const ex=(await as(P,async()=>(await db.query(`select ext_export_my_data() j`)).rows[0].j)); T('0015: export lists the alert log', Array.isArray(ex.alerts_sent) && ex.alerts_sent.length>=1);
  await as(P,()=>db.query(`select ext_delete_my_data()`)); T('0015: erase my data also removes the alert log', (await db.query(`select count(*)::int c from ext_alert_log where user_id='${P}'`)).rows[0].c===0 && (await db.query(`select count(*)::int c from ext_watchlist where user_id='${P}'`)).rows[0].c===0);
  // re-run
  const sql15=fs.readFileSync(M+'0015_ext_hardening.sql','utf8'); let twice=true; try{ await db.exec(sql15); await db.exec(sql15) }catch(e){ twice=false; console.log(e.message) }
  T('0015: runs again without error', twice);
}
// ===== 0016: phone and name are validated by the database =====
{ const up=(set)=>as(D,()=>db.query(`update ext_profiles set ${set} where id='${D}'`));
  T('0016: a valid +91 mobile is stored', !(await fails(up(`phone='+919876543210'`))) && (await db.query(`select phone from ext_profiles where id='${D}'`)).rows[0].phone==='+919876543210');
  for (const bad of ['9876543210','+915876543210','+91987654321','+9198765432101','+91 98765 43210',"+919876543210'; drop table ext_profiles;--",'abc','<script>']) T('0016: phone '+JSON.stringify(bad)+' is refused', await fails(up(`phone='${bad.replace(/'/g,"''")}'`)));
  T('0016: phone can be cleared', !(await fails(up(`phone=null`))));
  T('0016: name with markup or control characters is refused', await fails(up(`name='<img src=x onerror=alert(1)>'`)) && await fails(up(`name=E'bad\\x07name'`)));
  T('0016: name over 80 characters is refused', await fails(up(`name='${'a'.repeat(81)}'`)));
  T('0016: a normal name is stored', !(await fails(up(`name='Vishwajeet Trivedi'`)))); }

// ===== 0017: security hardening =====
{ await db.exec(fs.readFileSync(M+'0017_ext_security_hardening.sql','utf8')); await db.exec(fs.readFileSync(M+'0018_ext_security_followup.sql','utf8')); // the 0015 re-run test above re-installed 0015's functions over 0017's/0018's: put them back (a normal install applies 0017, then 0018, last)
  const mk=async(e,meta='{}')=>(await db.query(`insert into auth.users(email,raw_user_meta_data) values($1,$2::jsonb) returning id`,[e,meta])).rows[0].id;
  const asAnon=async fn=>{await db.exec(`set role anon; select set_config('request.jwt.claims','{"role":"anon"}',false)`); try{return await fn()} finally{await db.exec('reset role')}};
  const asSvc=async fn=>{await db.exec(`set role service_role; select set_config('request.jwt.claims','{"role":"service_role"}',false)`); try{return await fn()} finally{await db.exec('reset role')}};
  const clr=()=>db.exec(`select set_config('request.jwt.claims','',false)`); await clr();
  const X=await mk('x17@x.t'); await db.exec(`update ext_profiles set plan='max', contribute=true, created_at=now()-interval '10 days', email_alerts=true where id='${X}'`);
  const wl=(k,over={})=>as(X,()=>db.query(`insert into ext_watchlist(product_key,site,title,url,image,target_price) values($1,$2,$3,$4,$5,$6) on conflict (user_id,product_key) do update set title=excluded.title, url=excluded.url, image=excluded.image, site=excluded.site, target_price=excluded.target_price`,[k,over.site??'Amazon',over.title??'T',over.url??'https://www.amazon.in/dp/B0X',over.image??null,over.tp??null]));
  const wrow=async k=>(await db.query(`select * from ext_watchlist where user_id='${X}' and product_key=$1`,[k])).rows[0];
  const A500='a'.repeat(500);
  // --- watchlist text columns
  await wl('t1',{title:'Fan <b>big</b> > 5 \u0007 ‮ fast'}); T('0017: markup, control and bidi characters are stripped from a title instead of failing the sync', (await wrow('t1')).title==='Fan bbig/b  5   fast'.replace(/ {2,}/g,m=>m) || !/[<>\u0007‮]/.test((await wrow('t1')).title));
  await wl('t2',{title:'अ‍म Phone'}); T('0017: ZWJ (Indic scripts) stays allowed', (await wrow('t2')).title==='अ‍म Phone');
  T('0017: a 500 char title is kept, 501 is refused', !(await fails(wl('t3',{title:A500}))) && await fails(wl('t4',{title:A500+'a'})));
  for (const [n,u] of [['http scheme','http://www.amazon.in/x'],['javascript scheme','javascript:alert(1)'],['data scheme','data:text/html,x'],['space','https://a.in/x y'],['double quote','https://a.in/x"onerror=1'],['single quote',"https://a.in/x'y"],['angle bracket','https://a.in/<x>'],['backslash','https://a.in/x\\y'],['control char','https://a.in/x\u0001'],['501 chars','https://a.in/'+'a'.repeat(488)],['bare https://','https://']]) T('0017: url refused: '+n, await fails(wl('u'+n.length+n[0],{url:u})));
  T('0017: a normal https url (500 chars exactly) is stored', !(await fails(wl('u9',{url:'https://a.in/'+'a'.repeat(487)}))) && (await wrow('u9')).url.length===500);
  await wl('i1',{image:'http://img.example/a.png'}); await wl('i2',{image:'https://img.example/a.png'}); await wl('i3',{image:'https://img.example/'+'a'.repeat(600)});
  T('0017: an unusable image link becomes NULL, a good one is kept', (await wrow('i1')).image===null && (await wrow('i2')).image==='https://img.example/a.png' && (await wrow('i3')).image===null);
  T('0017: site over 60 chars refused, site markup stripped', await fails(wl('s1',{site:'s'.repeat(61)})) && (await wl('s2',{site:'Tata <b>CLiQ'}), (await wrow('s2')).site==='Tata bCLiQ'));
  for (const k of ['bad key','bad"key',"bad'key",'bad<key','bad\u0007key','bad`key','bad\\key','',  'k'.repeat(201)]) T('0017: product_key refused: '+JSON.stringify(k).slice(0,20), await fails(wl(k)));
  T('0017: real keys pass (domain:id, 200 chars)', !(await fails(wl('amazon.in:B0ABCDEF12'))) && !(await fails(wl('flipkart.com:'+'1'.repeat(187)))) );
  for (const v of [-1,10000000,'NaN']) T('0017: target_price '+v+' refused', await fails(wl('pr'+v,{tp:v})));
  T('0017: target_price 0 and 9999999.99 pass', !(await fails(wl('pr0',{tp:0}))) && !(await fails(wl('pr1',{tp:9999999.99}))));
  T('0017: the CHECKs themselves hold for the service role too (trigger cannot be the only guard)', await fails(db.query(`insert into ext_watchlist(user_id,product_key,url) values('${X}','svc1','ftp://x')`)));
  // --- profiles
  T('0017: name with a bidi override is refused, name with ZWJ passes', await as(X,()=>fails(db.query(`update ext_profiles set name=$1 where id='${X}'`,['evil‮name']))) && !(await as(X,()=>fails(db.query(`update ext_profiles set name=$1 where id='${X}'`,['अ‍म'])))));
  T('0017: avatar_url must be https and <= 500 chars (service role cannot store javascript:)', await fails(db.query(`update ext_profiles set avatar_url='javascript:alert(1)' where id='${X}'`)) && await fails(db.query(`update ext_profiles set avatar_url=$1 where id='${X}'`,['https://a.in/'+'a'.repeat(500)])) && !(await fails(db.query(`update ext_profiles set avatar_url='https://lh3.googleusercontent.com/a/x=s96-c' where id='${X}'`))));
  { const long='N'.repeat(200)+'<script>'; const Y=await mk('y17@x.t',JSON.stringify({full_name:long,picture:'javascript:alert(1)'}));
    const p=(await db.query(`select name,avatar_url from ext_profiles where id='${Y}'`)).rows[0];
    T('0017: sign-up with a hostile name / picture still gets a profile, cleaned (before: no profile at all)', p && p.name.length===80 && !/[<>]/.test(p.name) && p.avatar_url===null);
    await db.exec(`delete from ext_profiles where id='${Y}'`); await db.exec(`update auth.users set raw_user_meta_data=$$ {"name":"<i>Zed</i>","avatar_url":"https://a.in/z.png"} $$ where id='${Y}'`);
    await as(Y,()=>db.query('select ext_ensure_profile()')); const p2=(await db.query(`select name,avatar_url from ext_profiles where id='${Y}'`)).rows[0]; T('0017: ext_ensure_profile cleans the same way', p2 && p2.name==='iZed/i' && p2.avatar_url==='https://a.in/z.png'); }
  // --- observations RPC caps
  const obs=(rows)=>as(X,async()=>(await db.query(`select ext_upsert_observations($1::jsonb) n`,[JSON.stringify(rows)])).rows[0].n);
  const R=(i,over={})=>({product_key:'cap:'+i,site:'S',price:100+i,src:'dom',...over});
  const cnt=async()=>(await db.query(`select count(*)::int c from ext_price_observations where user_id='${X}'`)).rows[0].c;
  T('0017: 51 rows in one call: nothing stored', await obs(Array.from({length:51},(_,i)=>R(i)))===0 && await cnt()===0);
  T('0017: exactly 50 rows: all stored', await obs(Array.from({length:50},(_,i)=>R(i)))===50 && await cnt()===50);
  T('0017: not an array / null / object: 0', await obs({a:1})===0 && (await as(X,async()=>(await db.query(`select ext_upsert_observations(null) n`)).rows[0].n))===0);
  T('0017: > 40000 bytes in one call: nothing stored', await obs(Array.from({length:50},(_,i)=>R(100+i,{site:'x'.repeat(900)})))===0);
  T('0017: a row over 800 bytes, non-object rows, and keys with spaces/markup are skipped, good rows stored', await obs([R(200,{site:'z'.repeat(790)+'<<<'.repeat(40)}),'str',5,null,R(201,{product_key:'bad key'}),R(202,{product_key:'k<script>'}),R(203,{site:'<b>'}),R(204)])===1);
  T('0017: a row padded with junk fields (> 800 bytes) is skipped even though its real fields are valid', await obs([R(210,{junk:'j'.repeat(900)}),R(211)])===1);
  // --- history / chart inputs
  const hist=k=>as(X,async()=>(await db.query(`select * from ext_price_history($1,365,1)`,[k])).rows.length);
  T('0017: history with a 201 char key is empty, no error', await hist('k'.repeat(201))===0);
  T('0017: history and chart read cut a key over 200 chars before touching the index (function source)', (await Promise.all(['ext_price_history','ext_get_chart'].map(async f=>(await db.query(`select pg_get_functiondef(p.oid) d from pg_proc p where p.proname=$1`,[f])).rows[0].d))).every(d=>/length\(p_key\) <= 200/.test(d)));
  T('0017: chart read with a 201 char key is empty, no error', (await as(X,async()=>(await db.query(`select * from ext_get_chart($1)`,['k'.repeat(201)])).rows.length))===0);
  const today=Math.floor(Date.now()/864e5), chart=(k,ser=[[today-20,100],[today,105]],cur=105)=>as(X,async()=>(await db.query(`select ext_submit_chart($1,30,$2::jsonb,$3) r`,[k,JSON.stringify(ser),cur])).rows[0].r);
  T('0017: a legit chart is stored', await chart('amazon.in:CH1')===true);
  T('0017: chart keys with spaces / markup / 201 chars: false, never an error', (await chart('bad key'))===false && (await chart('a<b'))===false && (await chart('k'.repeat(201)))===false && (await chart(null))===false);
  T('0017: chart with 131 points / > 4000 bytes: false', (await chart('amazon.in:CH2',Array.from({length:131},(_,i)=>[today-131+i,100]),100))===false);
  // --- settings
  const merge=(doc,st)=>as(X,async()=>(await db.query('select ext_merge_settings($1::jsonb,$2::jsonb) r',[JSON.stringify(doc),JSON.stringify(st)])).rows[0].r);
  const NOW=Date.now(); await merge({pin:'560001'},{pin:NOW-5000});
  { const r=await merge({pin:'110001',range:'x'.repeat(9000)},{pin:NOW-1}); T('0017: oversize settings payload is ignored (stored state returned, no error)', r.doc.pin==='560001'); }
  T('0017: stores must be short identifiers', await as(X,()=>fails(db.query(`select ext_merge_settings('{"stores":["ok",5]}','{"stores":${NOW}}')`))) && await as(X,()=>fails(db.query(`select ext_merge_settings('{"stores":["a b"]}','{"stores":${NOW}}')`))) && await as(X,()=>fails(db.query(`select ext_merge_settings('{"stores":["<b>"]}','{"stores":${NOW}}')`))));
  T('0017: valid stores pass', !(await as(X,()=>fails(db.query(`select ext_merge_settings('{"stores":["croma.in","a-b_c"]}','{"stores":${NOW}}')`)))));
  for (const nm of ['<b>x','a‮b','a\u0007b']) T('0017: place name refused: '+JSON.stringify(nm), await as(X,()=>fails(db.query(`select ext_merge_settings($1::jsonb,$2::jsonb)`,[JSON.stringify({places:[{id:'p1',name:nm,pin:'842001'}]}),JSON.stringify({places:NOW+10})]))));
  T('0017: ext_remote_config key / value limits', await fails(db.query(`insert into ext_remote_config(key,value) values('Bad Key','{}')`)) && await fails(db.query(`insert into ext_remote_config(key,value) values('big', to_jsonb(repeat('a',9000)))`)) && !(await fails(db.query(`insert into ext_remote_config(key,value) values('ok_key','{"a":1}') on conflict (key) do nothing`))));
  T('0017: doc text size is capped on the table itself', await fails(db.query(`update ext_user_settings set doc=jsonb_build_object('stores', (select jsonb_agg('a') from generate_series(1,12)), 'places', '[]'::jsonb, 'pin', repeat('1',5000)) where user_id='${X}'`)));
  // --- feedback
  const fb=(args,hdr)=>asAnon(async()=>{ await db.exec(`select set_config('request.headers', '${hdr||'{}'}', false)`); return (await db.query(`select ext_submit_feedback($1,$2::text[],$3,$4) r`,args)).rows[0].r; });
  await db.exec(`delete from ext_feedback`);
  T('0017: feedback message of 1500 chars is cut to 1000', await fb([5,['bugs'],'m'.repeat(1500),'1.2.3'])===true && (await db.query(`select char_length(message) c from ext_feedback order by id desc limit 1`)).rows[0].c===1000);
  T('0017: feedback message over 2000 chars / 8000 bytes: refused', await fb([5,[],'m'.repeat(2001),null])===false && await fb([5,[],'é'.repeat(1900)+'€'.repeat(1000),null])===false);
  T('0017: feedback with 21 reasons refused, 20 accepted (unknown ones dropped)', await fb([5,Array.from({length:21},(_,i)=>'bugs'),null,null])===false && await fb([5,Array.from({length:20},()=>'bugs').concat([]),null,null])===true);
  { await fb([4,['bugs','evil'],'line1\nline2\u0007‮ ok',  'v'.repeat(50)]); const r=(await db.query(`select reasons,message,version from ext_feedback order by id desc limit 1`)).rows[0];
    T('0017: feedback keeps newlines, strips control / bidi characters, drops unknown reasons and a long version', r.reasons.join()==='bugs' && r.message==='line1\nline2 ok' && r.version===null); }
  T('0017: the feedback table itself refuses long messages, unknown reasons, odd ip_hash', await fails(db.query(`insert into ext_feedback(rating,message) values(5, repeat('a',1001))`)) && await fails(db.query(`insert into ext_feedback(rating,reasons) values(5,'{evil}')`)) && await fails(db.query(`insert into ext_feedback(rating,ip_hash) values(5,'abc')`)));
  { await db.exec(`delete from ext_feedback`); const H=ip=>`{"cf-connecting-ip":"${ip}","x-forwarded-for":"spoof-${Math.random()}"}`; let okc=0; for(let i=0;i<7;i++) if(await fb([5,[],null,null],H('203.0.113.9'))) okc++;
    T('0017: 5/hour per caller holds even when x-forwarded-for is spoofed (cf-connecting-ip wins)', okc===5 && await fb([5,[],null,null],H('203.0.113.10'))===true);
    await db.exec(`delete from ext_feedback; insert into ext_feedback(rating, created_at) select 3, now() from generate_series(1,500)`);
    T('0017: 500/hour overall cap stops address-spoofing floods', await fb([5,[],null,null],H('198.51.100.1'))===false);
    await db.exec(`delete from ext_feedback`); }
  // --- waitlist source
  await db.exec(`delete from public.waitlist where email='x17@x.t'`); await as(X,()=>db.query(`select ext_join_waitlist($1)`,['evil<script>']));
  T('0017: a hostile waitlist source is replaced by the default', (await db.query(`select source from public.waitlist where email='x17@x.t'`)).rows[0].source==='extension-android');
  await db.exec(`delete from public.waitlist where email='x17@x.t'`); await as(X,()=>db.query(`select ext_join_waitlist($1)`,['extension-ios']));
  T('0017: a normal extension-* source is kept', (await db.query(`select source from public.waitlist where email='x17@x.t'`)).rows[0].source==='extension-ios');
  // --- price alert mail
  await db.exec(`create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}') returns bigint language plpgsql as $f$ begin insert into net.calls(url,headers,body) values(url,headers,body); return 1; end $f$`);
  await db.exec(`delete from vault.decrypted_secrets; insert into vault.decrypted_secrets values('resend_api_key','re_test_secret'); insert into ext_remote_config(key,value) values('email','{"email_from":"HAULS <hello@hauls.in>"}') on conflict (key) do update set value=excluded.value`);
  await db.exec(`delete from ext_alert_log where user_id='${X}'`);
  for (const k of ['m1','m2','m3','m4','m5','m6','m7','m8']) await wl(k,{tp:500});
  const al=(k,title,url)=>as(X,async()=>(await db.query(`select ext_send_price_alert($1,$2,100,500,$3) r`,[k,title,url])).rows[0].r);
  const calls=async()=>(await db.query(`select count(*)::int c from net.calls`)).rows[0].c, last=async()=>(await db.query(`select body->>'html' h from net.calls order by id desc limit 1`)).rows[0].h;
  const n0=await calls(); 
  for (const [n,u] of [['quote','https://www.amazon.in/dp/X"onmouseover=alert(1)'],['apostrophe',"https://www.amazon.in/dp/X'y"],['angle','https://www.amazon.in/dp/X><script>'],['space','https://www.amazon.in/dp/X y'],['newline','https://www.amazon.in/dp/X\nBcc: a@b'],['backtick','https://www.amazon.in/dp/X`y'],['backslash','https://www.amazon.in/dp/X\\y'],['bidi','https://www.amazon.in/dp/X‮y']]) T('0017: alert refused (invalid, nothing sent, no limit used) for a link with '+n, await al('m1','T',u)==='invalid' && await calls()===n0);
  T('0017: an allowlisted link with & is queued and the & is escaped inside href', await al('m2','Item','https://www.amazon.in/dp/B0X?a=1&b=2')==='queued' && /href="https:\/\/www\.amazon\.in\/dp\/B0X\?a=1&amp;b=2"/.test(await last()) && !/href="[^"]*&(?!amp;)/.test(await last()));
  T('0017: the title is escaped incl. apostrophes and cut before escaping', await al('m3',`Bob's <i>"fan"</i> &`+'x'.repeat(300),null)==='queued' && /Bob&#39;s &lt;i&gt;&quot;fan&quot;&lt;\/i&gt; &amp;x/.test(await last()) && !/<i>/.test(await last()));
  T('0017: a link to another host (clean characters) just drops the button', await al('m4','T','https://evil.example/x')==='queued' && !/<a href/.test(await last()));
  T('0017: a very long clean link drops the button (> 500) but does not fail', await al('m5','T','https://www.amazon.in/'+'a'.repeat(600))==='queued' && !/<a href/.test(await last()));
  T('0017: a 2001 char link is refused outright', await al('m6','T','https://www.amazon.in/'+'a'.repeat(2000))==='invalid');
  T('0017: an alert key with a space is invalid', await al('bad key','T',null)==='invalid');
  // --- retention
  { await db.exec(`delete from ext_feedback; delete from ext_alert_log`);
    await db.exec(`insert into ext_alert_log(user_id,product_key,sent_at) values('${X}','old1',now()-interval '100 days'),('${X}','old2',now()-interval '91 days'),('${X}','new1',now()-interval '10 days'); insert into ext_feedback(rating,created_at) values (3,now()-interval '400 days'),(3,now()-interval '366 days'),(4,now()-interval '30 days')`);
    T('0017: signed-in users and anon cannot run the purge', await as(X,()=>fails(db.query('select ext_purge_old_data()'))) && await asAnon(()=>fails(db.query('select ext_purge_old_data()'))));
    T('0017: even a caller with the grant but an authenticated JWT is refused inside the function', await (async()=>{ await db.exec(`grant execute on function ext_purge_old_data() to authenticated`); try { return await as(X,()=>fails(db.query('select ext_purge_old_data()'))) } finally { await db.exec(`revoke execute on function ext_purge_old_data() from authenticated`) } })());
    const r=await asSvc(async()=>(await db.query('select ext_purge_old_data() r')).rows[0].r);
    T('0017: service role purges alert-log > 90 days and feedback > 1 year, nothing newer', r.alert_log===2 && r.feedback===2 && (await db.query(`select count(*)::int c from ext_alert_log`)).rows[0].c===1 && (await db.query(`select count(*)::int c from ext_feedback`)).rows[0].c===1);
    T('0017: purge is repeatable', (await asSvc(async()=>(await db.query('select ext_purge_old_data() r')).rows[0].r)).alert_log===0); }
  // --- role settings
  { const cfg=async role=>(await db.query(`select s.setconfig c from pg_db_role_setting s join pg_roles r on r.oid=s.setrole where r.rolname=$1 and s.setdatabase=0`,[role])).rows.flatMap(x=>x.c);
    const a=await cfg('anon'), u=await cfg('authenticated');
    T('0017: anon statement_timeout 3s, authenticated 5s, idle-in-transaction 15s for both', a.includes('statement_timeout=3s') && u.includes('statement_timeout=5s') && a.includes('idle_in_transaction_session_timeout=15s') && u.includes('idle_in_transaction_session_timeout=15s'), JSON.stringify([a,u])); }
  // --- grant matrix
  { const fnAuth=['ext_price_history','ext_upsert_observations','ext_submit_chart','ext_get_chart','ext_merge_settings','ext_send_price_alert','ext_join_waitlist','ext_ensure_profile','ext_export_my_data','ext_delete_my_data','ext_forget_my_observations','ext_purge_my_deleted_watchlist','ext_submit_feedback'];
    const fns=(await db.query(`select p.oid::regprocedure::text sig, p.proname nm, has_function_privilege('anon',p.oid,'execute') an, has_function_privilege('authenticated',p.oid,'execute') au, has_function_privilege('service_role',p.oid,'execute') sv,
       (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee=0)) pub from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'ext\\_%'`)).rows;
    const pure=['ext_hidden_re','ext_hidden','ext_spaced','ext_valid_key','ext_valid_text','ext_strip_text','ext_clean_url']; // 0018: the CHECKs call these as the writing role, so PUBLIC may run them
    T('0017: '+fns.length+' ext_ functions: PUBLIC has execute on none but the 0018 pure helpers', fns.length>=25 && fns.filter(f=>f.pub).map(f=>f.nm).sort().join()===[...pure].sort().join());
    T('0017: anon may execute only ext_submit_feedback (+ the 0018 pure helpers)', fns.filter(f=>f.an).map(f=>f.nm).sort().join()===['ext_submit_feedback',...pure].sort().join());
    T('0017: authenticated may execute exactly the client RPC list + pure helpers (no triggers, purge, settings validators)', fns.filter(f=>f.au).map(f=>f.nm).sort().join()===[...fnAuth,...pure].sort().join());
    T('0017: ext_purge_old_data is service_role only', fns.filter(f=>f.nm==='ext_purge_old_data').every(f=>f.sv && !f.an && !f.au));
    const tp=async(role,t,priv)=>(await db.query(`select has_table_privilege($1,$2,$3) v`,[role,'public.'+t,priv])).rows[0].v;
    const closed=['ext_price_observations','ext_chart_series','ext_feedback','ext_alert_log'];
    let bad=[]; for (const t of closed) for (const role of ['anon','authenticated']) for (const pr of ['select','insert','update','delete']) if (await tp(role,t,pr)) bad.push(role+':'+t+':'+pr);
    T('0017: observations, charts, feedback and alert log are closed to anon and authenticated', bad.length===0, bad.join());
    bad=[]; for (const pr of ['select','insert','update','delete']) if (await tp('anon','ext_profiles',pr)||await tp('anon','ext_watchlist',pr)||await tp('anon','ext_user_settings',pr)) bad.push(pr);
    T('0017: anon touches no per-user table', bad.length===0);
    T('0017: anon reads only ext_remote_config', await tp('anon','ext_remote_config','select') && !(await tp('anon','ext_remote_config','insert')) && !(await tp('authenticated','ext_remote_config','update')));
    T('0017: authenticated: profiles select-only at table level, settings select-only, watchlist CRUD', await tp('authenticated','ext_profiles','select') && !(await tp('authenticated','ext_profiles','insert')) && !(await tp('authenticated','ext_profiles','delete')) && await tp('authenticated','ext_user_settings','select') && !(await tp('authenticated','ext_user_settings','insert')) && !(await tp('authenticated','ext_user_settings','update')) && (await tp('authenticated','ext_watchlist','select')) && (await tp('authenticated','ext_watchlist','insert')) && (await tp('authenticated','ext_watchlist','delete')));
    const cp=async(c)=>(await db.query(`select has_column_privilege('authenticated','public.ext_profiles',$1,'update') v`,[c])).rows[0].v;
    T('0017: only name, contribute, phone, email_alerts are user-updatable on profiles', (await cp('name'))&&(await cp('contribute'))&&(await cp('phone'))&&(await cp('email_alerts'))&&!(await cp('plan'))&&!(await cp('email'))&&!(await cp('avatar_url'))&&!(await cp('id')));
    const seq=(await db.query(`select c.relname, has_sequence_privilege('anon',c.oid,'usage') a, has_sequence_privilege('authenticated',c.oid,'usage') u from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S' and c.relname like 'ext\\_%'`)).rows;
    T('0017: no ext_ sequence is usable by anon / authenticated ('+seq.length+' checked)', seq.length>=3 && seq.every(s=>!s.a&&!s.u)); }
  // --- idempotent
  { const cc=async()=>(await db.query(`select count(*)::int c from pg_constraint where conrelid::regclass::text like 'public.ext\\_%'`)).rows[0].c, before=await cc(); const sql17=fs.readFileSync(M+'0017_ext_security_hardening.sql','utf8'); let twice=true; try{ await db.exec(sql17); await db.exec(sql17) }catch(e){ twice=false; console.log(e.message) }
    T('0017: runs again without error and without duplicating constraints', twice && await cc()===before); }
}
// ===== 0018: security follow-up (one invisible class, tombstone abuse, confirmed email, feedback lock + /64, heart-only alerts) =====
{ await db.exec(fs.readFileSync(M+'0018_ext_security_followup.sql','utf8')); // the 0017 re-run test above put 0017's functions back over 0018's (that is exactly the replay hazard the README warns about)
  const dx=async q=>{ await db.exec(`select set_config('request.jwt.claims','',false)`); return db.exec(q) }; // as() leaves the last user's claims set: a superuser statement would otherwise run "as" that user (their triggers, their clock)
  const mk=async(e,conf=true)=>(await dx(`select set_config('request.jwt.claims','',false)`), (await db.query(`insert into auth.users(email,email_confirmed_at) values($1,${conf?'now()':'null'}) returning id`,[e])).rows[0].id);
  const asAnon=async fn=>{await db.exec(`set role anon; select set_config('request.jwt.claims','{"role":"anon"}',false)`); try{return await fn()} finally{await db.exec('reset role')}};
  const asSvc=async fn=>{await db.exec(`set role service_role; select set_config('request.jwt.claims','{"role":"service_role"}',false)`); try{return await fn()} finally{await db.exec('reset role')}};
  await dx(`select set_config('request.jwt.claims','',false)`);
  const Z=(...a)=>String.fromCodePoint(...a); // the invisible characters are built from code points on purpose: no hidden characters in this source
  const INV={'tag char U+E0041':Z(0xe0041),'tag cancel U+E007F':Z(0xe007f),'word joiner U+2060':Z(0x2060),'invisible plus U+2064':Z(0x2064),'isolate U+2066':Z(0x2066),'isolate U+2069':Z(0x2069),'soft hyphen U+00AD':Z(0xad),'bidi override U+202E':Z(0x202e),'zero width space U+200B':Z(0x200b),'BOM U+FEFF':Z(0xfeff),'C1 U+0085':Z(0x85)};
  const OKCH={'U+FFF9':Z(0xfff9),'U+FFFB':Z(0xfffb),'Mongolian U+180E':Z(0x180e),'ALM U+061C':Z(0x61c),'U+206A':Z(0x206a),'U+206F':Z(0x206f),'ZWNJ U+200C':Z(0x200c),'ZWJ U+200D':Z(0x200d)}; // dropped from the class (obscure / script use) or deliberately kept
  const SPC={'NBSP U+00A0':Z(0xa0),'narrow NBSP U+202F':Z(0x202f),'ideographic U+3000':Z(0x3000),'em space U+2003':Z(0x2003),'math space U+205F':Z(0x205f),'U+200A':Z(0x200a),'U+1680':Z(0x1680)};
  await dx(`insert into ext_remote_config(key,value) values('email','{"email_from":"HAULS <hello@hauls.in>"}') on conflict (key) do update set value=excluded.value; delete from vault.decrypted_secrets; insert into vault.decrypted_secrets values('resend_api_key','re_test_secret')`);
  await dx(`create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}') returns bigint language plpgsql as $f$ begin insert into net.calls(url,headers,body) values(url,headers,body); return 1; end $f$`);
  const U=await mk('u18@x.t'); await dx(`update ext_profiles set plan='max', contribute=true, created_at=now()-interval '10 days', email_alerts=true where id='${U}'`);
  const ins=(k,o={})=>as(U,()=>db.query(`insert into ext_watchlist(product_key,site,title,url,target_price,wish,last_price) values($1,$2,$3,$4,$5,$6,$7)`,[k,o.site??'Amazon',o.title??'T',o.url??'https://www.amazon.in/dp/B0X',o.tp??null,o.wish??false,o.last??null]));
  const row=async k=>(await db.query(`select * from ext_watchlist where user_id='${U}' and product_key=$1`,[k])).rows[0];
  // --- 1) one invisible class
  { const bad=[]; let i=0; for (const [n,c] of Object.entries(INV)) { await ins('t'+(++i),{title:'ab'+c+'cd',site:'Am'+c+'az'}); const r=await row('t'+i); if (r.title!=='abcd'||r.site!=='Amaz') bad.push(n+JSON.stringify([r.title,r.site])); }
    T('0018: every invisible / bidi / tag character is stripped from a watchlist title and site', bad.length===0, bad.join()); }
  { const bad=[]; for (const [n,c] of Object.entries(INV)) if (!(await as(U,()=>fails(db.query(`update ext_profiles set name=$1 where id='${U}'`,['a'+c+'b']))))) bad.push(n);
    T('0018: the profile name CHECK refuses every invisible / bidi / tag character', bad.length===0, bad.join()); }
  T('0018: ZWNJ and ZWJ (Indic scripts) are still allowed in a name and a title', !(await as(U,()=>fails(db.query(`update ext_profiles set name=$1 where id='${U}'`,['क्'+Z(0x200d)+'ष a'+Z(0x200c)+'b'])))) && (await (async()=>{ await ins('indic',{title:'क्'+Z(0x200d)+'ष a'+Z(0x200c)+'b'}); return (await row('indic')).title==='क्'+Z(0x200d)+'ष a'+Z(0x200c)+'b' })()));
  { const bad=[]; for (const [n,c] of Object.entries({...INV,...SPC})) if (!(await fails(ins('k'+c+'x')))) bad.push(n);
    T('0018: a product key with any invisible character or unicode space is refused', bad.length===0, bad.join()); }
  { const bad=[]; for (const [n,c] of Object.entries({...INV,...SPC})) { if (!(await fails(ins('u1',{url:'https://www.amazon.in/dp/X'+c+'y'})))) bad.push('watchlist '+n);
      if (!(await fails(db.query(`update ext_profiles set avatar_url=$1 where id='${U}'`,['https://a.in/p'+c+'.png'])))) bad.push('avatar '+n); }
    T('0018: a link (watchlist url, avatar) with any invisible character or unicode space is refused', bad.length===0, bad.join()); }
  { const bad=[]; for (const [n,c] of Object.entries({...INV,...SPC})) if (!(await fails(db.query(`insert into ext_price_observations(user_id,product_key,price,src) values('${U}',$1,10,'dom')`,['o'+c+'k'])))) bad.push(n);
    T('0018: the observation and alert-log key CHECKs refuse them too', bad.length===0 && await fails(db.query(`insert into ext_alert_log(user_id,product_key) values('${U}',$1)`,['a'+Z(0xa0)+'b'])) && await fails(db.query(`insert into ext_alert_log(user_id,product_key) values('${U}',$1)`,['a\u{E0041}b'])) && await fails(db.query(`insert into ext_chart_series(product_key,user_id,range_days,series,current_price) values($1,'${U}',30,'[[20000,1],[20001,2]]',2)`,['c'+Z(0x3000)+'d'])), bad.join()); }
  { const bad=[]; const obs=k=>as(U,async()=>(await db.query(`select ext_upsert_observations($1::jsonb) n`,[JSON.stringify([{product_key:k,site:'S',price:100,src:'dom'}])])).rows[0].n);
    for (const [n,c] of Object.entries({...INV,...SPC})) if ((await obs('ob'+c+'x'))!==0) bad.push(n);
    T('0018: the observation RPC skips such keys (control: a clean key is stored)', bad.length===0 && (await obs('ob:clean'))===1, bad.join()); }
  { const bad=[]; const today=Math.floor(Date.now()/864e5); const ch=k=>as(U,async()=>(await db.query(`select ext_submit_chart($1,30,$2::jsonb,100) r`,[k,JSON.stringify([[today-1,100],[today,100]])])).rows[0].r);
    for (const [n,c] of Object.entries({...INV,...SPC})) if ((await ch('ch'+c+'x'))!==false) bad.push(n);
    T('0018: the chart upload refuses such keys (control: a clean key is stored)', bad.length===0 && (await ch('amazon.in:CH18'))===true, bad.join()); }
  { const bad=[]; for (const [n,c] of Object.entries(INV)) { const p=JSON.stringify({places:[{id:'p1',name:'a'+c+'b',pin:'842001'}]}), s=JSON.stringify({places:Date.now()}); if (!(await as(U,()=>fails(db.query(`select ext_merge_settings($1::jsonb,$2::jsonb)`,[p,s]))))) bad.push(n); }
    T('0018: a saved-place name with any invisible character is refused', bad.length===0, bad.join()); }
  { const bad=[]; await dx(`delete from ext_feedback`); const fm=async m=>{ await asAnon(async()=>{ await dx(`select set_config('request.headers','{}',false)`); await db.query(`select ext_submit_feedback(5,'{}'::text[],$1,null)`,[m]) }); return (await db.query(`select message from ext_feedback order by id desc limit 1`)).rows[0].message };
    for (const [n,c] of Object.entries(INV)) if (await fm('a'+c+'b\nc')!=='ab\nc') bad.push(n);
    T('0018: anonymous feedback loses every invisible character but keeps newlines and ZWJ', bad.length===0 && await fm('x'+Z(0x200d)+'y\tz')==='x'+Z(0x200d)+'y\tz', bad.join());
    T('0018: the feedback table itself refuses them (a direct insert)', await fails(db.query(`insert into ext_feedback(rating,message) values(5,$1)`,['a\u{E0041}b']))); }
  { const bad=[]; for (const [n,c] of Object.entries({...INV,...SPC})) if (!(await as(U,async()=>(await db.query(`select ext_send_price_alert($1,'T',100,500,null) r`,['k'+c+'x`'.slice(0,0)])).rows[0].r==='invalid'))) bad.push('key '+n);
    for (const [n,c] of Object.entries({...INV,...SPC})) if ((await as(U,async()=>(await db.query(`select ext_send_price_alert('amazon.in:B0X','T',100,500,$1) r`,['https://www.amazon.in/dp/X'+c+'y'])).rows[0].r))!=='invalid') bad.push('url '+n);
    T('0018: the price-alert key and link refuse invisible characters and unicode spaces', bad.length===0, bad.join()); }
  { const bad=[]; let i=0; for (const [n,c] of Object.entries(OKCH)) { const k='ok'+(++i)+c+'x', t='ab'+c+'cd';
      if (await fails(ins(k,{title:t,site:'Am'+c+'az'}))) { bad.push('insert '+n); continue; } const r=await row(k); if (r.title!==t||r.site!=='Am'+c+'az') bad.push('stripped '+n);
      if (await as(U,()=>fails(db.query(`update ext_profiles set name=$1 where id='${U}'`,['a'+c+'b'])))) bad.push('name '+n); }
    T('0018: U+FFF9-FFFB, U+180E, U+061C, U+206A-206F, ZWNJ and ZWJ are ALLOWED (key, title, site, name)', bad.length===0, bad.join()); }
  T('0018: U+2060, U+E0041, U+00AD and U+202E are refused by the helper', (await db.query(`select bool_and(public.ext_hidden(c)) b, bool_or(public.ext_hidden(o)) o from unnest($1::text[]) c, unnest($2::text[]) o`,[[Z(0x2060),Z(0xe0041),Z(0xad),Z(0x202e)],Object.values(OKCH)])).rows.map(r=>r.b===true&&r.o===false)[0]);
  { const cps=[...Array.from({length:31},(_,i)=>i+1),0x7f,0x85,0x9f,0xad,0x200b,0x200e,0x200f,0x2028,0x2029,0x202a,0x202c,0x202e,0x2060,0x2061,0x2064,0x2066,0x2068,0x2069,0xfeff,0xe0000,0xe0041,0xe007f];
    const not=[0x200c,0x200d,0xfff9,0x180e,0x2065,0x206a,0x202f,0x20,0x41,0x7a,0xe9,0x915,0xe0080,0x1f600];
    const r=(await db.query(`select (select array_agg(c) from unnest($1::int[]) c where not public.ext_hidden('a'||chr(c)||'b')) miss, (select array_agg(c) from unnest($2::int[]) c where public.ext_hidden('a'||chr(c)||'b')) extra, public.ext_hidden($3) dev`,[cps,not,'क्'+Z(0x200d)+'ष'])).rows[0];
    T('0018: the escaped class matches every intended code point and none of ZWNJ, ZWJ, U+FFF9, U+180E, U+2065, letters, Devanagari with ZWJ', r.miss===null && r.extra===null && r.dev===false, JSON.stringify(r)); }
  { const q=fs.readFileSync(M+'0018_ext_security_followup.sql','utf8').match(/^--\s+(select public\.ext_hidden\(chr\(8203\).*;)$/m)[1];
    T('0018: the sanity query in the header gives t | f | t | f', JSON.stringify(Object.values((await db.query(q)).rows[0]))==='[true,false,true,false]', q); }
  { // the CHECKs call the helpers as the WRITING user: a normal signed-in write passes with the grant, and fails without it
    const wr=()=>as(U,async()=>{ await db.query(`update ext_profiles set name='Grant ok' where id='${U}'`); await db.query(`insert into ext_watchlist(product_key,title,url) values('grant:1','t','https://a.in/g') on conflict (user_id,product_key) do update set title='t2'`); });
    const okNow=!(await fails(wr()));
    await dx(`revoke execute on function public.ext_hidden(text) from public`); const brokeNoGrant=await fails(wr()); await dx(`grant execute on function public.ext_hidden(text) to public`);
    T('0018: a normal authenticated insert / update passes the CHECKs; without execute on ext_hidden it fails (the grant is needed)', okNow && brokeNoGrant && !(await fails(wr()))); }
  T('0018: ext_strip_text / ext_clean_url use the same class', (await db.query(`select public.ext_strip_text($1) a, public.ext_clean_url($2) b, public.ext_clean_url($3) c`,['a\u{E0041}'+Z(0xad)+'b','https://a.in/x'+Z(0xa0)+'y','https://a.in/ok'])).rows[0].a==='ab' && (await db.query(`select public.ext_clean_url($1) b`,['https://a.in/x'+Z(0x202f)+'y'])).rows[0].b===null);

  // --- 2) tombstone abuse
  { await dx(`insert into ext_watchlist(user_id,product_key,deleted_at) values('${U}','tomb:future','2999-01-01')`);
    T('0018: a far-future deleted_at is clamped to now() (also for the service role)', new Date((await row('tomb:future')).deleted_at)<=new Date(Date.now()+5e3));
    await dx(`update ext_watchlist set deleted_at='2998-01-01' where user_id='${U}' and product_key='tomb:future'`);
    T('0018: and on update', new Date((await row('tomb:future')).deleted_at)<=new Date(Date.now()+5e3));
    T('0018: a normal deleted_at in the past is left alone', await (async()=>{ await dx(`insert into ext_watchlist(user_id,product_key,deleted_at) values('${U}','tomb:past', now()-interval '3 days')`); return Date.now()-new Date((await row('tomb:past')).deleted_at)>2.9*864e5 })()); }
  { const F=await mk('f18@x.t'); const insF=(k,del)=>as(F,()=>db.query(`insert into ext_watchlist(product_key,title,deleted_at) values($1,'t',${del?'now()':'null'})`,[k]));
    for (let i=1;i<=20;i++) await insF('f'+i,false);
    T('0018: free plan: the 21st LIVE row is refused', await fails(insF('f21',false)));
    T('0018: tombstones do not count against the plan limit', !(await fails(insF('d1',true))));
    await as(F,()=>db.query(`insert into ext_watchlist(product_key,deleted_at) select 'd'||g, now() from generate_series(2,480) g`));
    T('0018: 20 live + 480 tombstones = 500 rows: a new tombstone is refused (hard ceiling for all rows)', await fails(insF('d480',true))); }
  { const W=await mk('w18@x.t'); await dx(`update ext_profiles set plan='max' where id='${W}'`);
    await as(W,()=>db.query(`insert into ext_watchlist(product_key,deleted_at) select 'tomb:'||g, now() from generate_series(1,500) g`));
    const cnt=async()=>(await db.query(`select count(*)::int c from ext_watchlist where user_id='${W}'`)).rows[0].c;
    T('0018: 3000 tombstones cannot be stored: 500 fit, the next new key is refused even on the max plan', await cnt()===500 && await as(W,()=>fails(db.query(`insert into ext_watchlist(product_key,deleted_at) values('tomb:501', now())`))));
    T('0018: a new LIVE row is refused at the ceiling too', await as(W,()=>fails(db.query(`insert into ext_watchlist(product_key,title) values('live:501','x')`))));
    T('0018: a write to an EXISTING key at the ceiling still works (upsert is not growth)', !(await as(W,()=>fails(db.query(`insert into ext_watchlist(product_key,title) values('tomb:1','Back') on conflict (user_id,product_key) do update set title=excluded.title, deleted_at=null`)))) && await cnt()===500);
    await dx(`update ext_watchlist set deleted_at=now()-interval '2 days' where user_id='${W}' and product_key in ('tomb:2','tomb:3','tomb:4')`);
    T('0018: at the ceiling the person\'s own tombstones older than 24 h are purged first, then the insert succeeds', !(await as(W,()=>fails(db.query(`insert into ext_watchlist(product_key,title) values('fresh','x')`)))) && await cnt()===498);
    // retention without the owner writing again
    await dx(`update ext_watchlist set deleted_at=now()-interval '2 days' where user_id='${W}' and product_key in ('tomb:5','tomb:6')`);
    const pre=(await db.query(`select count(*)::int c from ext_watchlist where deleted_at < now()-interval '24 hours'`)).rows[0].c;
    const r=await asSvc(async()=>(await db.query('select ext_purge_old_data() r')).rows[0].r);
    T('0018: ext_purge_old_data also deletes tombstones > 24 h for every account (no owner write needed), newer ones stay', pre>=2 && r.tombstones===pre && (await db.query(`select count(*)::int c from ext_watchlist where deleted_at < now()-interval '24 hours'`)).rows[0].c===0 && await cnt()===496 && (await asSvc(async()=>(await db.query('select ext_purge_old_data() r')).rows[0].r)).tombstones===0);
    T('0018: the purge is still closed to signed-in users', await as(W,()=>fails(db.query('select ext_purge_old_data()')))); }

  // --- 3) confirmed email only
  { const N=await mk('n18@x.t',false); await dx(`update ext_profiles set email_alerts=true where id='${N}'`);
    await dx(`insert into ext_watchlist(user_id,product_key,target_price,last_price) values('${N}','amazon.in:B0N18',500,600)`);
    const c0=(await db.query(`select count(*)::int c from net.calls`)).rows[0].c, send=()=>as(N,async()=>(await db.query(`select ext_send_price_alert('amazon.in:B0N18','T',450,500,null) r`)).rows[0].r);
    T('0018: an UNCONFIRMED account email never gets mail ("off", nothing sent, nothing logged)', await send()==='off' && (await db.query(`select count(*)::int c from net.calls`)).rows[0].c===c0 && (await db.query(`select count(*)::int c from ext_alert_log where user_id='${N}'`)).rows[0].c===0);
    await dx(`update auth.users set email_confirmed_at=now() where id='${N}'`);
    T('0018: once confirmed the same call is queued', await send()==='queued' && (await db.query(`select count(*)::int c from net.calls`)).rows[0].c===c0+1); }

  // --- 5) heart-only items
  { const H=await mk('h18@x.t'); await dx(`update ext_profiles set email_alerts=true where id='${H}'`);
    await dx(`insert into ext_watchlist(user_id,product_key,wish,target_price,last_price) values
      ('${H}','h:ok',true,null,1000),('${H}','h:ok2',true,null,1000),('${H}','h:lo',true,null,1000),('${H}','h:hi',true,null,1000),('${H}','h:nul',true,null,1000),('${H}','h:p',true,null,1000),
      ('${H}','h:edge1',true,null,1000),('${H}','h:edge2',true,null,1000),('${H}','h:nolast',true,null,null),('${H}','h:nowish',false,null,1000),('${H}','h:stored',true,500,1000)`);
    const al=(k,price,target)=>as(H,async()=>(await db.query(`select ext_send_price_alert($1,'T',$2,$3,null) r`,[k,price,target])).rows[0].r);
    const last=async()=>(await db.query(`select body->>'html' h from net.calls order by id desc limit 1`)).rows[0].h;
    T('0018: heart-only item, client line 900 (inside [85%,100%] of the stored 1000), price 850: queued, mail shows the line', await al('h:ok',850,900)==='queued' && /alert was ₹900/.test(await last()));
    T('0018: heart-only: a client line below 85% of the stored last price is refused', await al('h:lo',100,800)==='invalid');
    T('0018: heart-only: a client line above the stored last price is refused', await al('h:hi',100,1100)==='invalid');
    T('0018: heart-only: no client line is refused', await al('h:nul',100,null)==='invalid');
    T('0018: heart-only: a price above the accepted line is refused', await al('h:p',950,900)==='invalid');
    T('0018: heart-only: the boundaries 850 and 1000 are accepted', await al('h:edge1',800,850)==='queued' && await al('h:edge2',1000,1000)==='queued');
    T('0018: heart-only without a stored last price is refused', await al('h:nolast',100,900)==='invalid');
    T('0018: an item that is neither hearted nor has an alert price is still refused', await al('h:nowish',100,900)==='invalid');
    T('0018: a stored alert price wins: the client line is ignored (price 600 > stored 500)', await al('h:stored',600,1000)==='invalid' && await al('h:stored',450,1000)==='queued' && /alert was ₹500/.test(await last())); }

  // --- 4) feedback
  { const src=(await db.query(`select pg_get_functiondef('public.ext_submit_feedback'::regproc) d`)).rows[0].d;
    T('0018: feedback takes an advisory lock before the cap counts', /pg_advisory_xact_lock\(hashtext\('ext_feedback'\)\)/.test(src) && src.indexOf('pg_advisory_xact_lock')<src.indexOf('count(*)')); // PGlite is single-connection, so the race itself cannot be driven here
    const fb=ip=>asAnon(async()=>{ await dx(`select set_config('request.headers','${ip?`{"cf-connecting-ip":"${ip}"}`:'{}'}',false)`); return (await db.query(`select ext_submit_feedback(5,'{}'::text[],null,null) r`)).rows[0].r });
    await dx(`delete from ext_feedback`); let okc=0; for (let i=0;i<8;i++) if (await fb(`2001:db8:1:2:${i}::${i+1}`)) okc++;
    T('0018: IPv6: eight addresses inside one /64 share the 5/hour cap', okc===5);
    T('0018: IPv6: another /64 has its own bucket', await fb('2001:db8:1:3::1')===true);
    T('0018: IPv6: the same /64 written compressed or in upper case is the same bucket', await fb('2001:DB8:1:2:0:0:0:99')===false && await fb('2001:db8:1:2::')===false);
    await dx(`delete from ext_feedback`); okc=0; for (let i=0;i<5;i++) if (await fb('203.0.113.77')) okc++;
    T('0018: IPv4 still counts per address, and IPv4-mapped IPv6 is the same caller', okc===5 && await fb('::ffff:203.0.113.77')===false && await fb('203.0.113.78')===true);
    T('0018: the stored ip_hash stays a sha256 hex digest', (await db.query(`select bool_and(ip_hash ~ '^[0-9a-f]{64}$') b from ext_feedback where ip_hash is not null`)).rows[0].b===true);
    await dx(`delete from ext_feedback`); }
}

// ===== 0017: old dirty rows are cleaned before the CHECKs go on (fresh database stopped at 0016) =====
{ const d2=new PGlite();
  await d2.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
    create table public.waitlist(id uuid default gen_random_uuid(), email text, created_at timestamptz default now(), source text);
    grant usage on schema public, auth to anon, authenticated, service_role; grant all on all tables in schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role; alter default privileges in schema public grant execute on functions to anon, authenticated;`);
  for (const f of ['0001_ext_core','0002_ext_functions','0003_ext_rls','0004_ext_hardening','0005_ext_review_fixes','0006_ext_security_review','0007_ext_user_settings','0008_ext_settings_places','0009_ext_history_privacy','0010_ext_chart_series','0011_ext_obs_src_bg','0012_ext_feedback','0013_ext_watchlist_deletion','0014_ext_price_alert_email','0015_ext_hardening','0016_ext_profile_input_checks']) await d2.exec(fs.readFileSync(M+f+'.sql','utf8'));
  const U=(await d2.query(`insert into auth.users(email) values('d17@x.t') returning id`)).rows[0].id;
  await d2.exec(`update ext_profiles set avatar_url='javascript:alert(1)' where id='${U}'`);
  await d2.exec(`insert into ext_watchlist(user_id,product_key,title,site,url,image,target_price,last_price) values
    ('${U}','good:1','Fine title','Amazon','https://a.in/p','https://a.in/i.png',100,90),
    ('${U}','dirty:1','A <b>bold</b> ' || chr(7) || 'title ' || chr(8238), 'Site<', 'https://a.in/x y', 'https://' || repeat('a',600), -5, 99999999),
    ('${U}','bad key',null,null,null,null,null,null),
    ('${U}','dirty:2',null,null,'https://' || repeat('b',700),null,null,null)`);
  const stamp=(await d2.query(`select updated_at from ext_watchlist where product_key='good:1'`)).rows[0].updated_at;
  await d2.exec(`insert into ext_price_observations(user_id,product_key,site,price,src) values('${U}','bad key','S',10,'dom'),('${U}','obs:1','S<',10,'dom'),('${U}','obs:2','Fine',11,'dom')`);
  await d2.exec(`insert into ext_chart_series(product_key,user_id,range_days,series,current_price) values('bad key','${U}',30,'[[20000,1],[20001,2]]',2),('chart:1','${U}',30,'[[20000,1],[20001,2]]',2)`);
  await d2.exec(`insert into ext_alert_log(user_id,product_key) values('${U}','bad key'),('${U}','alert:1')`);
  await d2.exec(`insert into ext_feedback(rating,reasons,message,ip_hash) values (4,'{evil,bugs}', repeat('m',1500) || chr(7), 'zz'), (5,'{}','ok message','${'a'.repeat(64)}')`);
  await d2.exec(`insert into ext_user_settings(user_id,doc,stamps) values ('${U}', '{"pin":"560001","stores":["a b"],"places":[{"id":"p1","name":"<b>","pin":"123456"}]}', '{"pin":1,"stores":2,"places":3}')`);
  const sql17=fs.readFileSync(M+'0017_ext_security_hardening.sql','utf8'); let ran=true; try { await d2.exec(sql17); await d2.exec(sql17) } catch(e) { ran=false; console.log(e.message) }
  T('0017: applies to a database holding dirty rows (twice)', ran);
  const q=async s=>(await d2.query(s)).rows;
  T('0017: old avatar_url javascript: is cleared', (await q(`select avatar_url from ext_profiles where id='${U}'`))[0].avatar_url===null);
  const w=Object.fromEntries((await q(`select * from ext_watchlist`)).map(r=>[r.product_key,r]));
  T('0017: dirty watchlist title / site / url / image / prices are cleaned, good row untouched, unusable key row removed', w['dirty:1'] && !/[<>\u0007‮]/.test(w['dirty:1'].title) && w['dirty:1'].title.startsWith('A bbold/b') && w['dirty:1'].site==='Site' && w['dirty:1'].url===null && w['dirty:1'].image===null && w['dirty:1'].target_price===null && w['dirty:1'].last_price===null
    && w['dirty:2'].url===null && w['good:1'].title==='Fine title' && w['good:1'].url==='https://a.in/p' && +w['good:1'].target_price===100 && String(w['good:1'].updated_at)===String(stamp) && !w['bad key']);
  T('0017: bad observation / chart / alert-log keys removed, bad site cleared, good rows kept', (await q(`select string_agg(product_key||':'||coalesce(site,'null'),',' order by product_key) s from ext_price_observations`))[0].s==='obs:1:null,obs:2:Fine' && (await q(`select string_agg(product_key,',') s from ext_chart_series`))[0].s==='chart:1' && (await q(`select string_agg(product_key,',') s from ext_alert_log`))[0].s==='alert:1');
  const fbk=await q(`select * from ext_feedback order by id`);
  T('0017: old feedback is cut / filtered / un-hashed to fit the new CHECKs', fbk[0].message.length===1000 && !/\u0007/.test(fbk[0].message) && fbk[0].reasons.join()==='bugs' && fbk[0].ip_hash===null && fbk[1].message==='ok message' && fbk[1].ip_hash==='a'.repeat(64));
  const st=(await q(`select doc,stamps from ext_user_settings`))[0];
  T('0017: old stores / places that break the new rules are dropped, other settings kept', st.doc.pin==='560001' && !('stores' in st.doc) && !('places' in st.doc) && st.stamps.pin===1 && !('places' in st.stamps));
  // ----- 0018 on top of that database: rows that only the WIDER class or the tombstone rule objects to (0017's rules accepted them) -----
  { const Z=(...a)=>String.fromCodePoint(...a), tag=Z(0xE0041), nb=Z(0xa0), alm=Z(0xad); // soft hyphen: refused only since 0018
    await d2.exec(`select set_config('request.jwt.claims','',false)`);
    await d2.query(`insert into ext_watchlist(user_id,product_key,title,site,url) values ('${U}','good:2','Good','Amazon','https://a.in/ok'),('${U}',$1,'t',null,null),('${U}','tag:1',$2,$3,$4)`,['nb:1'+nb+'x','Ti'+tag+'tle','Si'+alm+'te','https://a.in/x'+nb+'y']);
    await d2.exec(`insert into ext_watchlist(user_id,product_key,deleted_at) values ('${U}','tomb:future','2999-01-01')`);
    await d2.query(`insert into ext_price_observations(user_id,product_key,site,price,src) values ('${U}',$1,'S',10,'dom'),('${U}','obs:3',$2,11,'dom')`,['obs'+nb+'k','S'+tag]);
    await d2.query(`insert into ext_chart_series(product_key,user_id,range_days,series,current_price) values ($1,'${U}',30,'[[20000,1],[20001,2]]',2)`,['ch'+nb+'k']);
    await d2.query(`insert into ext_alert_log(user_id,product_key) values ('${U}',$1)`,['al'+tag+'k']);
    await d2.query(`insert into ext_feedback(rating,message) values (5,$1)`,['fe'+tag+'ed']);
    await d2.query(`update ext_profiles set name=$1 where id='${U}'`,['Na'+alm+'me']);
    await d2.query(`update ext_user_settings set doc = doc || $1::jsonb, stamps = stamps || '{"places":5}' where user_id='${U}'`,[JSON.stringify({places:[{id:'p1',name:'Ho'+tag+'me',pin:'842001'}]})]);
    const sql18=fs.readFileSync(M+'0018_ext_security_followup.sql','utf8'); let ran=true; try { await d2.exec(sql18); await d2.exec(sql18) } catch(e) { ran=false; console.log(e.message) }
    T('0018: applies to a database holding such rows (twice)', ran);
    const q=async s=>(await d2.query(s)).rows, w=Object.fromEntries((await q(`select * from ext_watchlist`)).map(r=>[r.product_key,r]));
    T('0018: invisible characters are stripped from old titles / sites, the unusable-link becomes NULL, good rows are untouched', w['tag:1'].title==='Title' && w['tag:1'].site==='Site' && w['tag:1'].url===null && w['good:2'].title==='Good' && w['good:2'].url==='https://a.in/ok');
    T('0018: a watchlist key with a unicode space is removed (a key cannot be repaired)', !w['nb:1'+nb+'x']);
    T('0018: an old far-future tombstone is pulled back to now()', new Date(w['tomb:future'].deleted_at)<=new Date(Date.now()+5e3));
    T('0018: old observation / chart keys with a unicode space are removed, a tag character in a site is cleared, tag-character alert-log key removed', (await q(`select string_agg(product_key||':'||coalesce(site,'null'),',' order by product_key) s from ext_price_observations`))[0].s==='obs:1:null,obs:2:Fine,obs:3:null' && (await q(`select count(*)::int c from ext_chart_series where product_key <> 'chart:1'`))[0].c===0 && (await q(`select count(*)::int c from ext_alert_log where product_key <> 'alert:1'`))[0].c===0);
    T('0018: old feedback, profile name and saved places are cleaned', (await q(`select message from ext_feedback where message like 'fe%'`))[0].message==='feed' && (await q(`select name from ext_profiles where id='${U}'`))[0].name==='Name' && !('places' in (await q(`select doc from ext_user_settings`))[0].doc)); }
  await d2.close?.(); }
// ===== 0019: waitlist functions need a CONFIRMED email =====
{ await db.exec(fs.readFileSync(M+'0019_ext_waitlist_confirmed_email.sql','utf8')); // earlier re-run tests put 0017's functions back over 0019's
  const W=(await db.query(`insert into auth.users(email,email_confirmed_at) values('w1@x.t',null) returning id`)).rows[0].id, V=(await db.query(`insert into auth.users(email,email_confirmed_at) values('w2@x.t',now()) returning id`)).rows[0].id;
  await as(W,()=>db.query(`select ext_ensure_profile()`)); await as(V,()=>db.query(`select ext_ensure_profile()`));
  T('0019: an UNCONFIRMED email cannot join the waitlist', (await as(W,()=>db.query(`select ext_join_waitlist('extension-android') j`))).rows[0].j===false && (await db.query(`select count(*) n from waitlist where email='w1@x.t'`)).rows[0].n==0);
  T('0019: a confirmed email joins once, then false', (await as(V,()=>db.query(`select ext_join_waitlist('extension-android') j`))).rows[0].j===true && (await as(V,()=>db.query(`select ext_join_waitlist('extension-android') j`))).rows[0].j===false);
  await db.query(`insert into waitlist(email,source) values('w1@x.t','extension-android')`);
  await as(W,()=>db.query(`select ext_delete_my_data()`));
  T('0019: erase by an unconfirmed account does NOT delete a waitlist row for that address', (await db.query(`select count(*) n from waitlist where email='w1@x.t'`)).rows[0].n==1);
  await as(V,()=>db.query(`select ext_delete_my_data()`));
  T('0019: erase by a confirmed account removes its own extension waitlist row', (await db.query(`select count(*) n from waitlist where email='w2@x.t'`)).rows[0].n==0);
  await db.exec(fs.readFileSync(M+'0019_ext_waitlist_confirmed_email.sql','utf8')); T('0019: runs twice without error', true); }
// ===== 0020: retention for old observations and chart series (400 days) =====
{ await db.exec(fs.readFileSync(M+'0020_ext_observation_retention.sql','utf8')); // earlier re-run tests (0017, 0018) put their purge back over 0020's
  const dx=async q=>{ await db.exec(`select set_config('request.jwt.claims','',false)`); return db.exec(q) };
  const asSvc=async fn=>{await db.exec(`set role service_role; select set_config('request.jwt.claims','{"role":"service_role"}',false)`); try{return await fn()} finally{await db.exec('reset role')}};
  const asAnon=async fn=>{await db.exec(`set role anon; select set_config('request.jwt.claims','{"role":"anon"}',false)`); try{return await fn()} finally{await db.exec('reset role')}};
  const purge=()=>asSvc(async()=>(await db.query('select ext_purge_old_data() r')).rows[0].r);
  await dx(`select set_config('request.jwt.claims','',false)`);
  const R=(await db.query(`insert into auth.users(email) values('r20@x.t') returning id`)).rows[0].id;
  await dx(`delete from ext_price_observations; delete from ext_chart_series;
    insert into ext_price_observations(user_id,product_key,price,observed_at) values
      ('${R}','r20:old',100,(now() at time zone 'UTC')::date::timestamp at time zone 'UTC' - interval '401 days'),
      ('${R}','r20:edge',100,(now() at time zone 'UTC')::date::timestamp at time zone 'UTC' - interval '400 days'),
      ('${R}','r20:new',100,now() - interval '30 days'),('${R}','r20:today',100,now());
    insert into ext_chart_series(product_key,user_id,range_days,series,current_price,captured_at) values
      ('r20:old','${R}',30,'[[20000,1],[20001,2]]',2,now()-interval '401 days'),
      ('r20:edge','${R}',30,'[[20000,1],[20001,2]]',2,now()-interval '399 days 23 hours'),
      ('r20:new','${R}',30,'[[20000,1],[20001,2]]',2,now()-interval '10 days');
    delete from ext_alert_log; delete from ext_feedback;
    insert into ext_alert_log(user_id,product_key,sent_at) values('${R}','r20:a',now()-interval '91 days');
    insert into ext_feedback(rating,created_at) values (3,now()-interval '400 days');
    insert into ext_watchlist(user_id,product_key,deleted_at) values('${R}','r20:t',now()-interval '2 days')`);
  const keys=async t=>(await db.query(`select string_agg(product_key,',' order by product_key) k from ${t}`)).rows[0].k;
  T('0020: signed-in users and anon still cannot run the purge', await as(R,()=>fails(db.query('select ext_purge_old_data()'))) && await asAnon(()=>fails(db.query('select ext_purge_old_data()'))));
  T('0020: nothing was deleted by the refused calls', await keys('ext_price_observations')==='r20:edge,r20:new,r20:old,r20:today' && await keys('ext_chart_series')==='r20:edge,r20:new,r20:old');
  const r=await purge();
  T('0020: observations older than 400 days are deleted, the boundary day (exactly 400) and newer rows stay', r.observations===1 && await keys('ext_price_observations')==='r20:edge,r20:new,r20:today', JSON.stringify(r));
  T('0020: chart series older than 400 days are deleted, newer ones stay', r.charts===1 && await keys('ext_chart_series')==='r20:edge,r20:new', JSON.stringify(r));
  T('0020: the older purge duties still run and are counted (alert_log, feedback, tombstones)', r.alert_log===1 && r.feedback===1 && r.tombstones===1, JSON.stringify(r));
  const r2=await purge(); T('0020: runs twice (second run deletes nothing)', r2.observations===0 && r2.charts===0 && await keys('ext_price_observations')==='r20:edge,r20:new,r20:today');
  await db.exec(fs.readFileSync(M+'0020_ext_observation_retention.sql','utf8')); T('0020: the file applies twice without error', true);
  T('0020: still service role only after re-applying', await as(R,()=>fails(db.query('select ext_purge_old_data()'))) && (await purge()).observations===0);
  const ix=(await db.query(`select indexdef d from pg_indexes where tablename in ('ext_price_observations','ext_chart_series')`)).rows.map(x=>x.d).join(' ');
  T('0020: indexes on observed_day and captured_at exist', /\(observed_day\)/.test(ix) && /\(captured_at\)/.test(ix)); }
process.exit(ok?0:1);
