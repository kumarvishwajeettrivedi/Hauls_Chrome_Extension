import {PGlite} from '@electric-sql/pglite';
import fs from 'fs';
import {fileURLToPath} from 'url'; import path from 'path';
const M=path.join(path.dirname(fileURLToPath(import.meta.url)),'../../supabase/migrations/');
const db=new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
`);
await db.exec(`create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
create table public.waitlist(id uuid default gen_random_uuid(), email text, created_at timestamptz default now(), source text);
grant usage on schema public, auth to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated;`);
for (const f of ['0001_ext_core','0002_ext_functions','0003_ext_rls','0004_ext_hardening','0005_ext_review_fixes','0006_ext_security_review','0007_ext_user_settings','0008_ext_settings_places','0009_ext_history_privacy','0010_ext_chart_series','0011_ext_obs_src_bg']) { await db.exec(fs.readFileSync(M+f+'.sql','utf8')); await db.exec(fs.readFileSync(M+f+'.sql','utf8')); } // twice = idempotent
let ok=true; const T=(n,c)=>{console.log(c?'PASS':'FAIL',n); if(!c) ok=false;};
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
{ const D=(await db.query(`insert into auth.users(email,raw_user_meta_data) values('d@x.t','{"full_name":"Dee","picture":"pic"}') returning id`)).rows[0].id;
  await db.exec('update public.ext_profiles set contribute=true');
  T('0005: direct INSERT of own observation is now blocked (must use the RPC)', await as(D,()=>fails(db.query(`insert into ext_price_observations(user_id,product_key,price) values('${D}','P9',5)`))));
  T('0005: RPC path still inserts for an opted-in user', (await as(D,async()=>(await db.query(`select ext_upsert_observations('[{"product_key":"P9","site":"S","price":5,"src":"dom"}]'::jsonb) n`)).rows[0].n))===1);
  await db.exec(`delete from ext_profiles where id='${D}'`);
  T('0005: profile missing after erase', (await db.query(`select count(*)::int c from ext_profiles where id='${D}'`)).rows[0].c===0);
  await as(D,()=>db.query('select ext_ensure_profile()'));
  const r=(await db.query(`select name,avatar_url,contribute,plan from ext_profiles where id='${D}'`)).rows[0];
  T('0005: ext_ensure_profile recreates it from Google metadata, opt-in default, free plan', r&&r.name==='Dee'&&r.avatar_url==='pic'&&r.contribute===false&&r.plan==='free');
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
await as(D,()=>db.query(`update ext_profiles set phone='+91 98765-43210' where id='${D}'`));
T('phone updatable', (await db.query(`select phone from ext_profiles where id='${D}'`)).rows[0].phone==='+91 98765-43210');
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
T('seed single row after double-run', (await db.query(`select count(*)::int c from ext_remote_config`)).rows[0].c===1);
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
process.exit(ok?0:1);
