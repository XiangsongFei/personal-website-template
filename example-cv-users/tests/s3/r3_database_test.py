"""Offline M5 contract and transaction model. Never opens a database connection."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
from threading import Barrier, Lock
import unittest

HERE = Path(__file__).resolve().parent
M5 = HERE.parents[1] / 'supabase/migrations/20261110183047_s3_registered_business_proofs.sql'
SQL = M5.read_text()
UID = 'a33b0000-0000-4000-8000-000000000001'
SID = 'a33b0000-0000-4000-8000-000000000004'
PROJECT = 'ecv-s33a-20261109-7dd22a81'


class Denied(Exception):
    pass


def require(ok):
    if not ok:
        raise Denied()


class Model:
    """A transaction copy and one mutex model serial outcomes, not real PG locks/RLS."""
    def __init__(self):
        self.now = 1_000
        self.runtime = self.verifier = False
        self.actor = (UID, SID, 'password')
        self.state = {'epoch': 1, 'enabled': True, 'hold': False}
        self.key = {'id': 'offline-generation', 'revoked': False}
        self.registered, self.receipts, self.grants = {}, {}, {}
        self.lock = Lock()

    def register(self, p, principal, after_insert=None):
        with self.lock:
            require(principal == 'registrar' and self.runtime and self.verifier)
            require(not self.key['revoked'] and self.key['id'] == p['kid'])
            require(p['project'] == PROJECT and p['iat'] <= self.now < p['exp'] <= p['iat']+60)
            require(p['id'] not in self.registered)
            staged = deepcopy(self.registered)
            staged[p['id']] = deepcopy(p)
            if after_insert is not None:
                after_insert()
            require(self.now < p['exp'])
            self.registered = staged

    def apply(self, p, fail_at_receipt=False):
        with self.lock:
            require(self.runtime and self.verifier and self.state is not None)
            require(self.actor == (p['uid'],p['sid'],'password'))
            require(self.registered.get(p['id']) == p and p['id'] not in self.receipts)
            require(not self.key['revoked'] and self.key['id'] == p['kid'])
            require(p['epoch'] == self.state['epoch'] and p['iat'] <= self.now < p['exp'])
            if p['action'] != 'revoke':
                require(self.state['enabled'] and self.state['hold'] is False)
            updated = deepcopy(self.grants)
            scope = (p['uid'],p['sid'])
            g = updated.get(scope)
            if p['action'] == 'issue':
                require(g is None)
                updated[scope] = dict(revoked=False, expiry=self.now+1800, absolute=self.now+43200, kid=p['kid'], epoch=p['epoch'])
            elif p['action'] == 'renew':
                require(g and not g['revoked'] and g['kid']==p['kid'] and g['epoch']==p['epoch'] and self.now < min(g['expiry'],g['absolute']))
                g['expiry'] = min(self.now+1800,g['absolute'])
            else:
                require(p['action']=='revoke' and g and g['epoch']==p['epoch'])
                g['revoked'] = True
            if fail_at_receipt:
                raise RuntimeError('model receipt failure')
            self.grants = updated
            self.receipts[p['id']] = p['action']


class TicketTransactions(unittest.TestCase):
    def setUp(self):
        self.db = Model()
        self.db.runtime = self.db.verifier = True
        self.p = dict(id='t1',kid=self.db.key['id'],uid=UID,sid=SID,project=PROJECT,epoch=1,
                      iat=1000,exp=1060,action='issue',digest='public-payload',purpose='business')

    def register(self,p=None):
        self.db.register(self.p if p is None else p,'registrar')

    def test_no_self_registration(self):
        for role in ('anon','authenticated','authenticator','service_role','postgres'):
            with self.subTest(role=role),self.assertRaises(Denied):self.db.register(self.p,role)
        with self.assertRaises(Denied):self.db.apply(self.p)
        self.assertEqual(self.db.grants,{})

    def test_one_use(self):
        self.register()
        self.db.apply(self.p)
        with self.assertRaises(Denied):self.db.apply(self.p)
        with self.assertRaises(Denied):self.register()
        self.assertEqual((len(self.db.receipts),len(self.db.grants)),(1,1))

    def test_registration_wait_exceeds_ttl(self):
        def time_after_index_wait():self.db.now=self.p['exp']
        with self.assertRaises(Denied):
            self.db.register(self.p,'registrar',after_insert=time_after_index_wait)
        self.assertFalse(self.db.registered or self.db.grants or self.db.receipts)

    def test_failed_consumption_rollback(self):
        self.register()
        with self.assertRaises(RuntimeError):self.db.apply(self.p,fail_at_receipt=True)
        self.assertEqual(self.db.receipts,{})
        self.assertEqual(self.db.grants,{})
        self.assertEqual(len(self.db.registered),1)

    def test_public_fields_cannot_be_rebound(self):
        self.register()
        for field,wrong in [('id','t2'),('kid','other'),('uid',SID),('sid',UID),('project','other'),
                             ('epoch',0),('exp',1061),('action','renew'),('digest','other'),('purpose','admin')]:
            with self.subTest(field=field),self.assertRaises(Denied):self.db.apply(dict(self.p,**{field:wrong}))
        self.assertFalse(self.db.receipts)

    def test_denied_after_registration(self):
        for change in ('session','uid','recovery','epoch','hold','absent_state','expired','revoked_key','stopped'):
            with self.subTest(change=change):
                self.setUp()
                self.register()
                if change=='session':self.db.actor=(UID,'wrong','password')
                if change=='uid':self.db.actor=('wrong',SID,'password')
                if change=='recovery':self.db.actor=(UID,SID,'recovery')
                if change=='epoch':self.db.state['epoch']+=1
                if change=='hold':self.db.state['hold']=True
                if change=='absent_state':self.db.state=None
                if change=='expired':self.db.now=self.p['exp']
                if change=='revoked_key':self.db.key['revoked']=True
                if change=='stopped':self.db.runtime=False
                with self.assertRaises(Denied):self.db.apply(self.p)
                self.assertFalse(self.db.receipts or self.db.grants)

    def test_concurrent_duplicate_one_transition(self):
        self.register()
        rendezvous=Barrier(2)
        def consume():
            rendezvous.wait(timeout=2)
            try:self.db.apply(self.p)
            except Denied:return 'denied'
            return 'accepted'
        with ThreadPoolExecutor(max_workers=2) as pool:
            tasks=[pool.submit(consume) for _ in range(2)]
            self.assertCountEqual([f.result(timeout=3) for f in tasks],['denied','accepted'])
        self.assertEqual((len(self.db.grants),len(self.db.receipts)),(1,1))

    def test_renew_and_revoke_never_end_active_in_either_lock_order(self):
        for actions in [('renew','revoke'),('revoke','renew')]:
            self.setUp()
            self.register()
            self.db.apply(self.p)
            for action in actions:
                p=dict(self.p,id='intent-'+action,action=action)
                self.register(p)
                if action=='renew' and actions[0]=='revoke':
                    with self.assertRaises(Denied):self.db.apply(p)
                else:
                    self.db.apply(p)
            self.assertTrue(self.db.grants[(UID,SID)]['revoked'])

    def test_revoke_can_close_an_already_held_account(self):
        self.register()
        self.db.apply(self.p)
        self.db.state['hold']=True
        p=dict(self.p,id='logout',action='revoke')
        self.register(p)
        self.db.apply(p)
        self.assertTrue(self.db.grants[(UID,SID)]['revoked'])

    def test_revoked_and_expired_grant_never_revives(self):
        self.register();self.db.apply(self.p)
        revoke=dict(self.p,id='t2',action='revoke')
        renew=dict(self.p,id='t3',action='renew')
        self.register(revoke);self.register(renew)
        self.db.apply(revoke)
        with self.assertRaises(Denied):self.db.apply(renew)
        issue_again=dict(self.p,id='t4')
        self.register(issue_again)
        with self.assertRaises(Denied):self.db.apply(issue_again)
        self.setUp();self.register();self.db.apply(self.p)
        self.db.now+=1800
        renew.update(iat=self.db.now,exp=self.db.now+60)
        self.register(renew)
        with self.assertRaises(Denied):self.db.apply(renew)


def body(sql, name):
    begin=sql.index('FUNCTION '+name+'(')
    return sql[begin:sql.index('$fn$;',begin)]


def source_errors(sql):
    errors=[]
    def check(ok,why):
        if not ok:errors.append(why)
    reg=body(sql,'site_private.register_business_ticket')
    check("session_user<>'ecv_s3_proof_registrar'" in reg and "IS DISTINCT FROM 'none'" in reg,'registrar')
    check(reg.index('check_ticket_claims') < reg.index('INSERT INTO') < reg.rfind('check_ticket_claims') < reg.index('RETURN true'),'registration validation before/after wait')
    verify=body(sql,'site_private.verify_business_proof')
    for invariant in ['r.auth_user_id=caller_uid','r.auth_session_id=caller_sid','r.proof=p',"p->>'uid' IS DISTINCT FROM caller_uid::text"]:
        check(invariant in verify,'ticket binding')
    claims=body(sql,'site_private.check_ticket_claims')
    for invariant in ['k.revoked_at IS NULL','expires-issued>60','expires<=extract(epoch FROM t)',
                      'k.sign_until','k.verify_until','computed_digest<>','cardinality(fields)']:
        check(invariant in claims,'claim/time')
    apply=body(sql,'site_api.apply_business_grant')
    sequence=['lock_proof_configuration','business_identity','FOR UPDATE','verify_business_proof','security.security_epoch',
              'PROOF_ALREADY_CONSUMED','INSERT INTO site_private.business_session_grants','INSERT INTO site_private.grant_proofs','RETURN result']
    pos=[apply.find(needle) for needle in sequence]
    check(min(pos)>=0 and pos==sorted(pos),'atomic consumption')
    for invariant in ['g.revoked_at IS NOT NULL','g.expires_at<=t','g.absolute_expires_at<=t','security.security_hold','security.hold_reason']:
        check(invariant in apply,'eligibility')
    check('INSERT INTO site_private.user_security_state' not in apply,'unknown security state')
    check('AND k.revoked_at IS NULL' in body(sql,'site_private.business_qualified'),'generation revocation')
    check('pg_advisory_xact_lock_shared(3303, 5)' in sql and 'pg_advisory_xact_lock(3303, 5)' in sql,'configuration fence')
    check('DROP CONSTRAINT' not in sql and 'CHECK (enabled = proof_verifier_ready)' in sql,'closed gates')
    check('NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS' in sql,'role')
    check(sql.count('ENABLE ROW LEVEL SECURITY')==sql.count('FORCE ROW LEVEL SECURITY')==2,'RLS')
    check('FROM expected EXCEPT SELECT * FROM actual' in sql and 'FROM actual EXCEPT SELECT * FROM expected' in sql,'exact table ACL')
    grants=[s.strip() for s in sql.split(';') if s.strip().startswith('GRANT ') and 'TO ecv_s3_proof_registrar' in s]
    check(len(grants)==2 and all(('GRANT USAGE ON SCHEMA site_private' in s or 'GRANT EXECUTE ON FUNCTION site_private.register_business_ticket(jsonb)' in s) for s in grants),'registrar privileges')
    return errors


class MigrationContract(unittest.TestCase):
    def test_m5(self):
        self.assertEqual(source_errors(SQL),[])
        self.assertNotIn('extensions.hmac',SQL)
        self.assertNotIn('get_byte(',SQL)

    def test_scope_mutants(self):
        for anchor in ["session_user<>'ecv_s3_proof_registrar'",'r.proof=p','r.auth_session_id=caller_sid',
                       'k.revoked_at IS NULL','expires-issued>60','g.revoked_at IS NOT NULL','security.hold_reason',
                       'PROOF_ALREADY_CONSUMED','NOBYPASSRLS','pg_advisory_xact_lock_shared(3303, 5)',
                       'FROM actual EXCEPT SELECT * FROM expected','CHECK (enabled = proof_verifier_ready)','FORCE ROW LEVEL SECURITY']:
            with self.subTest(anchor=anchor):
                self.assertTrue(source_errors(SQL.replace(anchor,'REMOVED')))
        self.assertTrue(source_errors(SQL.replace('PERFORM site_private.check_ticket_claims(p);\n RETURN true;', 'RETURN true;')))
        self.assertTrue(source_errors(SQL+"\nGRANT SELECT ON site_private.business_proof_keys TO ecv_s3_proof_registrar;"))


if __name__=='__main__':
    unittest.main(verbosity=2)
