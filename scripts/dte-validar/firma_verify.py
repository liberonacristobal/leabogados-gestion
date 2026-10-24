# Verifica, con una implementación independiente (lxml C14N + cryptography), cada <Signature> de los XML: el digest del elemento
# referenciado (C14N inclusiva) y la firma RSA-SHA1 del SignedInfo con la llave del KeyInfo. Así lo valida el SII.
import sys, base64, hashlib, copy, io
from lxml import etree
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes
DS = 'http://www.w3.org/2000/09/xmldsig#'
def c14n(el):
    out = io.BytesIO(); etree.ElementTree(copy.deepcopy(el)).write_c14n(out); return out.getvalue()
def b2i(b): return int.from_bytes(base64.b64decode(b), 'big')
mal = 0
for f in sys.argv[1:]:
    root = etree.parse(f).getroot()
    ids = {e.get('ID'): e for e in root.iter() if e.get('ID')}
    for sig in root.iter('{%s}Signature' % DS):
        ref = sig.find('.//{%s}Reference' % DS); uri = ref.get('URI').lstrip('#'); el = ids[uri]
        target = copy.deepcopy(el)
        for s in target.findall('{%s}Signature' % DS): target.remove(s)   # transform enveloped
        dig = base64.b64encode(hashlib.sha1(c14n(target)).digest()).decode()
        ok_d = dig == sig.find('.//{%s}DigestValue' % DS).text
        si = sig.find('{%s}SignedInfo' % DS)
        pub = rsa.RSAPublicNumbers(b2i(sig.find('.//{%s}Exponent' % DS).text), b2i(sig.find('.//{%s}Modulus' % DS).text)).public_key()
        try: pub.verify(base64.b64decode(sig.find('{%s}SignatureValue' % DS).text), c14n(si), padding.PKCS1v15(), hashes.SHA1()); ok_s = True
        except Exception: ok_s = False
        print(f'{f} · #{uri}: digest {"OK" if ok_d else "NO CALZA"} · firma {"OK" if ok_s else "INVÁLIDA"}')
        mal += (not ok_d) + (not ok_s)
sys.exit(1 if mal else 0)
