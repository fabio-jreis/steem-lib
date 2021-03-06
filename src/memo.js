var ByteBuffer = require('bytebuffer')
var Aes = require('./aes')
var ops = require('./operations')
var assert = require('assert')
var base58 = require('bs58')

var encMemo = ops.encrypted_memo

/**
    Some fields are only required if the memo is marked for decryption (starts with a hash).
    @arg {string|PrivateKey} private_key - WIF or PrivateKey object
    @arg {string} memo - plain text is returned, hash prefix base58 is decrypted
    @return {string} - utf8 decoded string (hash prefix)
*/
function decode(private_key, memo) {
    assert(memo, 'memo is required')
    assert.equal(typeof memo, 'string', 'memo')
    if(!/^#/.test(memo)) return memo
    memo = memo.substring(1)

    assert(private_key, 'private_key is required')

    memo = base58.decode(memo)
    memo = encMemo.fromBuffer(new Buffer(memo, 'binary'))

    var from = memo.from;
    var to = memo.to;
    var nonce = memo.nonce;
    var check = memo.check;
    var encrypted = memo.encrypted;

    var pubkey = private_key.toPublicKey().toString()
    var otherpub = pubkey === from.toString() ? to.toString() : from.toString()
    memo = Aes.decrypt(private_key, otherpub, nonce, encrypted, check)

    // remove varint length prefix
    var mbuf = ByteBuffer.fromBinary(memo.toString('binary'), ByteBuffer.DEFAULT_CAPACITY, ByteBuffer.LITTLE_ENDIAN)
    try {
        // I get better luck using readVString .. but (see cache)
        return mbuf.readVString()
    } catch(e) {
        // Piston's encrypted memos fail the above varibale length utf-8 conversion.
        // The origainal code works for Piston.
        // https://github.com/steemit/steemit.com/issues/202
        var len = mbuf.readVarint32() // remove the varint length prefix
        var remaining = mbuf.remaining()
        if(len !== remaining) // warn
            console.error("Memo's length prefix " + len + " does not match remaining bytes " + remaining);
        memo = new Buffer(mbuf.toString('binary'), 'binary').toString('utf-8')
        return memo
    }
}

/**
    Some fields are only required if the memo is marked for encryption (starts with a hash).
    @arg {string|PrivateKey} private_key - WIF or PrivateKey object
    @arg {string|PublicKey} public_key - Recipient
    @arg {string} memo - plain text is returned, hash prefix text is encrypted
    @arg {string} [testNonce = undefined] - just for testing
    @return {string} - base64 decoded string (or plain text)
*/
function encode(private_key, public_key, memo, testNonce) {
    assert(memo, 'memo is required')
    assert.equal(typeof memo, 'string', 'memo')
    if(!/^#/.test(memo)) return memo
    memo = memo.substring(1)

    assert(private_key, 'private_key is required')
    assert(public_key, 'public_key is required')

    var mbuf = new ByteBuffer(ByteBuffer.DEFAULT_CAPACITY, ByteBuffer.LITTLE_ENDIAN)
    mbuf.writeVString(memo)
    memo = new Buffer(mbuf.copy(0, mbuf.offset).toBinary(), 'binary')

    var enc = Aes.encrypt(private_key, public_key, memo, testNonce)
    memo = encMemo.fromObject({
        from: private_key.toPublicKey(),
        to: public_key,
        nonce: enc.nonce,
        check: enc.checksum,
        encrypted: enc.message
    })
    // serialize
    memo = encMemo.toBuffer(memo)
    return '#' + base58.encode(new Buffer(memo, 'binary'))
}

module.exports = {
    encode: encode,
    decode: decode
}