program token11.aleo;

mapping account:
    key as address.public;
    value as u64.public;

function mint_public:
    input r0 as u64.public;
    input r1 as address.public;
    async mint_public r1 r0 into r2;
    output r2 as token11.aleo/mint_public.future;

finalize mint_public:
    input r0 as address.public;
    input r1 as u64.public;
    get.or_use account[r0] 0u64 into r2;
    add r2 r1 into r3;
    set r3 into account[r0];

function transfer_public:
    input r0 as address.public;
    input r1 as u64.public;
    async transfer_public self.caller r1 r0 into r2;
    output r2 as token11.aleo/transfer_public.future;

finalize transfer_public:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as address.public;
    get.or_use account[r0] 0u64 into r3;
    gte r3 r1 into r4;
    assert.eq r4 true;
    sub r3 r1 into r5;
    set r5 into account[r0];
    get.or_use account[r2] 0u64 into r6;
    add r6 r1 into r7;
    set r7 into account[r2];
