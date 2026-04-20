// The 'test_token13' test program.
import token13.aleo;
program test_token13.aleo {
    @test
    @should_fail
    fn test_main_fails() {
        let result: u32 = token13.aleo::main(2u32, 3u32);
        assert_eq(result, 3u32);
    }

    @noupgrade
    constructor() {}
}
