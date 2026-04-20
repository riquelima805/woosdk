// The 'test_token11' test program.
import token11.aleo;
program test_token11.aleo {
    @test
    @should_fail
    fn test_main_fails() {
        let result: u32 = token11.aleo::main(2u32, 3u32);
        assert_eq(result, 3u32);
    }

    @noupgrade
    constructor() {}
}
