program amm_pair.aleo;

mapping reserves_x:
    key as address.public;
    value as u64.public;

mapping reserves_y:
    key as address.public;
    value as u64.public;

mapping total_supply:
    key as address.public;
    value as u64.public;

mapping balances_x:
    key as address.public;
    value as u64.public;

mapping balances_y:
    key as address.public;
    value as u64.public;

mapping balance_lp:
    key as address.public;
    value as u64.public;

function add_liquidity:
    input r0 as address.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u64.public;
    input r4 as u64.public;
    async add_liquidity self.caller r2 r3 r0 r1 amm_pair.aleo r4 into r5;
    output r5 as amm_pair.aleo/add_liquidity.future;

finalize add_liquidity:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as u64.public;
    input r3 as address.public;
    input r4 as address.public;
    input r5 as address.public;
    input r6 as u64.public;
    get.or_use balances_x[r0] 0u64 into r7;
    get.or_use balances_y[r0] 0u64 into r8;
    gte r7 r1 into r9;
    assert.eq r9 true;
    gte r8 r2 into r10;
    assert.eq r10 true;
    get.or_use reserves_x[r3] 0u64 into r11;
    get.or_use reserves_y[r4] 0u64 into r12;
    get.or_use total_supply[r5] 0u64 into r13;
    is.eq r12 0u64 into r14;
    mul r2 r11 into r15;
    div r15 r12 into r16;
    ternary r14 0u64 r16 into r17;
    is.eq r11 0u64 into r18;
    mul r1 r12 into r19;
    div r19 r11 into r20;
    ternary r18 0u64 r20 into r21;
    mul r17 r13 into r22;
    div r22 r11 into r23;
    ternary r18 0u64 r23 into r24;
    mul r21 r13 into r25;
    div r25 r12 into r26;
    ternary r14 0u64 r26 into r27;
    lte r17 r1 into r28;
    ternary r28 r24 r27 into r29;
    is.eq r13 0u64 into r30;
    add r1 r2 into r31;
    ternary r30 r31 r29 into r32;
    gte r32 r6 into r33;
    assert.eq r33 true;
    sub r7 r1 into r34;
    set r34 into balances_x[r0];
    sub r8 r2 into r35;
    set r35 into balances_y[r0];
    add r11 r1 into r36;
    set r36 into reserves_x[r3];
    add r12 r2 into r37;
    set r37 into reserves_y[r4];
    add r13 r32 into r38;
    set r38 into total_supply[r5];
    get.or_use balance_lp[r0] 0u64 into r39;
    add r39 r32 into r40;
    set r40 into balance_lp[r0];

function swap_x_for_y:
    input r0 as address.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u64.public;
    async swap_x_for_y self.caller r2 r0 r1 r3 into r4;
    output r4 as amm_pair.aleo/swap_x_for_y.future;

finalize swap_x_for_y:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as address.public;
    input r3 as address.public;
    input r4 as u64.public;
    get.or_use balances_x[r0] 0u64 into r5;
    gte r5 r1 into r6;
    assert.eq r6 true;
    get.or_use reserves_x[r2] 0u64 into r7;
    get.or_use reserves_y[r3] 0u64 into r8;
    mul r1 997u64 into r9;
    mul r9 r8 into r10;
    mul r7 1000u64 into r11;
    add r11 r9 into r12;
    div r10 r12 into r13;
    gte r13 r4 into r14;
    assert.eq r14 true;
    lte r13 r8 into r15;
    assert.eq r15 true;
    add r7 r1 into r16;
    set r16 into reserves_x[r2];
    sub r8 r13 into r17;
    set r17 into reserves_y[r3];
    get.or_use balances_y[r0] 0u64 into r18;
    sub r5 r1 into r19;
    set r19 into balances_x[r0];
    add r18 r13 into r20;
    set r20 into balances_y[r0];

function swap_y_for_x:
    input r0 as address.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u64.public;
    async swap_y_for_x self.caller r2 r0 r1 r3 into r4;
    output r4 as amm_pair.aleo/swap_y_for_x.future;

finalize swap_y_for_x:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as address.public;
    input r3 as address.public;
    input r4 as u64.public;
    get.or_use balances_y[r0] 0u64 into r5;
    gte r5 r1 into r6;
    assert.eq r6 true;
    get.or_use reserves_x[r2] 0u64 into r7;
    get.or_use reserves_y[r3] 0u64 into r8;
    mul r1 997u64 into r9;
    mul r9 r7 into r10;
    mul r8 1000u64 into r11;
    add r11 r9 into r12;
    div r10 r12 into r13;
    gte r13 r4 into r14;
    assert.eq r14 true;
    lte r13 r7 into r15;
    assert.eq r15 true;
    add r8 r1 into r16;
    set r16 into reserves_y[r3];
    sub r7 r13 into r17;
    set r17 into reserves_x[r2];
    get.or_use balances_x[r0] 0u64 into r18;
    sub r5 r1 into r19;
    set r19 into balances_y[r0];
    add r18 r13 into r20;
    set r20 into balances_x[r0];

function deposit_x:
    input r0 as address.public;
    input r1 as u64.public;
    async deposit_x self.caller r1 into r2;
    output r2 as amm_pair.aleo/deposit_x.future;

finalize deposit_x:
    input r0 as address.public;
    input r1 as u64.public;
    get.or_use balances_x[r0] 0u64 into r2;
    add r2 r1 into r3;
    set r3 into balances_x[r0];

function withdraw_x:
    input r0 as address.public;
    input r1 as u64.public;
    async withdraw_x self.caller r1 into r2;
    output r2 as amm_pair.aleo/withdraw_x.future;

finalize withdraw_x:
    input r0 as address.public;
    input r1 as u64.public;
    get.or_use balances_x[r0] 0u64 into r2;
    gte r2 r1 into r3;
    assert.eq r3 true;
    sub r2 r1 into r4;
    set r4 into balances_x[r0];

function deposit_y:
    input r0 as address.public;
    input r1 as u64.public;
    async deposit_y self.caller r1 into r2;
    output r2 as amm_pair.aleo/deposit_y.future;

finalize deposit_y:
    input r0 as address.public;
    input r1 as u64.public;
    get.or_use balances_y[r0] 0u64 into r2;
    add r2 r1 into r3;
    set r3 into balances_y[r0];

function withdraw_y:
    input r0 as address.public;
    input r1 as u64.public;
    async withdraw_y self.caller r1 into r2;
    output r2 as amm_pair.aleo/withdraw_y.future;

finalize withdraw_y:
    input r0 as address.public;
    input r1 as u64.public;
    get.or_use balances_y[r0] 0u64 into r2;
    gte r2 r1 into r3;
    assert.eq r3 true;
    sub r2 r1 into r4;
    set r4 into balances_y[r0];
